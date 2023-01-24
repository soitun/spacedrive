use crate::job::{JobError, JobReportUpdate, JobResult, JobState, StatefulJob, WorkerContext};

use std::{
	hash::Hash,
	path::PathBuf,
	sync::{Arc, Mutex},
};

use async_zip::write::ZipFileWriter;
use serde::{Deserialize, Serialize};
use specta::Type;
use tokio::{
	fs::{File, OpenOptions},
	io::AsyncWriteExt,
};
use tracing::{trace, warn};

use super::{context_menu_fs_info, osstr_to_string, FsInfo, ObjectType};

pub struct FileArchiverJob {}

#[derive(Serialize, Deserialize, Clone)]
pub struct FileArchiverJobState {
	pub root_path: PathBuf, // if this is a directory, all children need to be relative
	pub root_type: ObjectType,
	pub writer: Arc<Mutex<ZipFileWriter<File>>>,
}

#[derive(Serialize, Deserialize, Hash, Type)]
pub struct FileArchiverJobInit {
	pub location_id: i32,
	pub path_id: i32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct FileArchiverJobStep {
	pub fs_info: FsInfo,
}

pub const ARCHIVE_JOB_NAME: &str = "file_archiver";

#[async_trait::async_trait]
impl StatefulJob for FileArchiverJob {
	type Init = FileArchiverJobInit;
	type Data = FileArchiverJobState;
	type Step = FileArchiverJobStep;

	fn name(&self) -> &'static str {
		ARCHIVE_JOB_NAME
	}

	async fn init(&self, ctx: WorkerContext, state: &mut JobState<Self>) -> Result<(), JobError> {
		let fs_info = context_menu_fs_info(
			&ctx.library_ctx.db,
			state.init.location_id,
			state.init.path_id,
		)
		.await?;

		let file = File::create(fs_info.obj_name + ".zip").await?;
		let mut zip = ZipFileWriter::new(file);

		state.data = Some(FileArchiverJobState {
			root_path: fs_info.obj_path.clone(),
			root_type: fs_info.obj_type.clone(),
			writer: Mutex::new(zip),
		});

		state.steps = [FileArchiverJobStep { fs_info }].into_iter().collect();

		ctx.progress(vec![JobReportUpdate::TaskCount(state.steps.len())]);

		Ok(())
	}

	async fn execute_step(
		&self,
		ctx: WorkerContext,
		state: &mut JobState<Self>,
	) -> Result<(), JobError> {
		let step = &state.steps[0];
		let info = &step.fs_info;

		match info.obj_type {
			ObjectType::File => {
				// let mut file = OpenOptions::new()
				// 	.read(true)
				// 	.write(true)
				// 	.open(&info.obj_path)
				// 	.await?;
				// let file_len = file.metadata().await?.len();

				// sd_crypto::fs::erase::erase(&mut file, file_len as usize, state.init.passes)
				// 	.await?;
				// file.set_len(0).await?;
				// file.flush().await?;
				// drop(file);

				// trace!("Erasing file: {:?}", info.obj_path);

				// tokio::fs::remove_file(&info.obj_path).await?;
			}
			ObjectType::Directory => {
				// let mut dir = tokio::fs::read_dir(&info.obj_path).await?;
				// while let Some(entry) = dir.next_entry().await? {
				// 	if entry.metadata().await?.is_dir() {
				// 		state.steps.push_back(FileArchiverJobStep {
				// 			fs_info: FsInfo {
				// 				obj_id: None,
				// 				obj_name: String::new(),
				// 				obj_path: entry.path(),
				// 				obj_type: ObjectType::Directory,
				// 			},
				// 		});
				// 	} else {
				// 		state.steps.push_back(FileArchiverJobStep {
				// 			fs_info: FsInfo {
				// 				obj_id: None,
				// 				obj_name: osstr_to_string(Some(&entry.file_name()))?,
				// 				obj_path: entry.path(),
				// 				obj_type: ObjectType::File,
				// 			},
				// 		});
				// 	};

				// 	ctx.progress(vec![JobReportUpdate::TaskCount(state.steps.len())]);
				// }
			}
		};

		ctx.progress(vec![JobReportUpdate::CompletedTaskCount(
			state.step_number + 1,
		)]);
		Ok(())
	}

	async fn finalize(&self, _ctx: WorkerContext, state: &mut JobState<Self>) -> JobResult {
		if let Some(ref info) = state.data {
			if info.root_type == ObjectType::Directory {
				tokio::fs::remove_dir_all(&info.root_path).await?;
			}
		} else {
			warn!("missing job state, unable to fully finalize job");
		}

		Ok(Some(serde_json::to_value(&state.init)?))
	}
}
