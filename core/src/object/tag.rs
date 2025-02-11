use prisma_client_rust::QueryError;
use serde::Deserialize;
use specta::Type;

use uuid::Uuid;

use crate::prisma::{tag, PrismaClient};

#[derive(Type, Deserialize)]
pub struct Tag {
	pub name: String,
	pub color: String,
}

impl Tag {
	#[allow(dead_code)]
	pub fn new(name: String, color: String) -> Self {
		Self { name, color }
	}

	#[allow(dead_code)]
	pub async fn save(self, db: &PrismaClient) -> Result<(), QueryError> {
		db.tag()
			.create(
				Uuid::new_v4().as_bytes().to_vec(),
				vec![
					tag::name::set(Some(self.name)),
					tag::color::set(Some(self.color)),
				],
			)
			.exec()
			.await?;

		Ok(())
	}
}
