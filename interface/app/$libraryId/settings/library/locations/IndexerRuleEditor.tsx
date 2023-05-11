import { uuid4 } from '@sentry/utils';
import clsx from 'clsx';
import { Info, Trash, X } from 'phosphor-react';
import {
	ChangeEvent,
	ComponentProps,
	forwardRef,
	useCallback,
	useId,
	useRef,
	useState
} from 'react';
import { createPortal } from 'react-dom';
import { Controller, ControllerRenderProps, FormProvider } from 'react-hook-form';
import {
	IndexerRule,
	RuleKind,
	UnionToTuple,
	extractInfoRSPCError,
	useLibraryMutation,
	useLibraryQuery
} from '@sd/client';
import { Button, Card, Divider, Input, Select, SelectOption, Switch, Tooltip } from '@sd/ui';
import { ErrorMessage, Form, Input as FormInput, useZodForm, z } from '@sd/ui/src/forms';
import { showAlertDialog } from '~/components';
import { useCallbackToWatchForm, useOperatingSystem } from '~/hooks';
import { usePlatform } from '~/util/Platform';
import { openDirectoryPickerDialog } from './AddLocationDialog';
import RuleInput from './RuleInput';
import { inputKinds } from './RuleInput';

// NOTE: This should be updated whenever RuleKind is changed
const ruleKinds: UnionToTuple<RuleKind> = [
	'AcceptFilesByGlob',
	'RejectFilesByGlob',
	'AcceptIfChildrenDirectoriesArePresent',
	'RejectIfChildrenDirectoriesArePresent'
];

interface RulesInputProps {
	form: string;
	onChange: ComponentProps<'input'>['onChange'];
	className: string;
	onInvalid: ComponentProps<'input'>['onInvalid'];
}

type IndexerRuleIdFieldType = ControllerRenderProps<
	{ indexerRulesIds: number[] },
	'indexerRulesIds'
>;

interface RuleButtonProps<T extends IndexerRuleIdFieldType> {
	rule: IndexerRule;
	field?: T;
	editable?: boolean;
	disabled?: boolean;
}

function RuleButton<T extends IndexerRuleIdFieldType>({
	rule,
	field,
	editable,
	disabled
}: RuleButtonProps<T>) {
	const timeoutId = useRef<number>(0);
	const [willDelete, setWillDelete] = useState<boolean>(false);
	const [isDeleting, setIsDeleting] = useState<boolean>(false);
	const listIndexerRules = useLibraryQuery(['locations.indexer_rules.list']);
	const deleteIndexerRule = useLibraryMutation(['locations.indexer_rules.delete']);

	const value = field?.value ?? [];
	const ruleEnabled = value.includes(rule.id);

	return (
		<Button
			size="sm"
			onClick={
				field &&
				(() =>
					field.onChange(
						ruleEnabled
							? value.filter((v) => v !== rule.id)
							: Array.from(new Set([...value, rule.id]))
					))
			}
			variant={disabled ? 'outline' : ruleEnabled ? 'gray' : 'colored'}
			disabled={disabled || isDeleting || !field}
			className={clsx('relative w-[130px] overflow-hidden')}
		>
			{rule.name}
			{editable && !rule.default && (
				<div
					onClick={(e) => {
						e.stopPropagation();
						e.preventDefault();
						if (willDelete) {
							setIsDeleting(true);
							deleteIndexerRule
								.mutateAsync(rule.id)
								.then(
									() => listIndexerRules.refetch(),
									(error) =>
										showAlertDialog({
											title: 'Error',
											value: String(error) || 'Failed to add location'
										})
								)
								.finally(() => {
									setWillDelete(false);
									setIsDeleting(false);
								});
						} else {
							setWillDelete(true);
						}
					}}
					onMouseEnter={() => {
						const id = timeoutId.current;
						timeoutId.current = 0;
						if (id) clearTimeout(id);
					}}
					onMouseLeave={() => {
						timeoutId.current = setTimeout(() => {
							timeoutId.current = 0;
							if (!isDeleting) setWillDelete(false);
						}, 500);
					}}
					className={clsx(
						'absolute right-0 top-0 flex h-full cursor-pointer content-center items-center justify-center justify-items-center overflow-hidden bg-red-500 transition-[width]',
						willDelete ? 'w-full' : 'w-4'
					)}
				>
					{willDelete ? 'Delete?' : <X className="!pointer-events-none" />}
				</div>
			)}
		</Button>
	);
}

interface RulesInputProps {
	form: string;
	onChange: ComponentProps<'input'>['onChange'];
	className: string;
	onInvalid: ComponentProps<'input'>['onInvalid'];
}

const RuleTabsInput = {
	Name: forwardRef<HTMLInputElement, RulesInputProps>((props, ref) => {
		const os = useOperatingSystem(true);
		return (
			<Input
				ref={ref}
				size="md"
				// TODO: The check here shouldn't be for which os the UI is running, but for which os the node is running
				pattern={os === 'windows' ? '[^<>:"/\\|?*\u0000-\u0031]*' : '[^/\0]+'}
				placeholder="File/Directory name"
				{...props}
			/>
		);
	}),
	Extension: forwardRef<HTMLInputElement, RulesInputProps>((props, ref) => (
		<Input
			ref={ref}
			size="md"
			pattern="^\.[^\.\s]+$"
			aria-label="Add a file extension to the current rule"
			placeholder="File extension (e.g., .mp4, .jpg, .txt)"
			{...props}
		/>
	)),
	Path: forwardRef<HTMLInputElement, RulesInputProps>(({ className, ...props }, ref) => {
		const os = useOperatingSystem(true);
		const platform = usePlatform();
		const isWeb = platform.platform === 'web';
		return (
			<Input
				ref={ref}
				size="md"
				pattern={
					isWeb
						? // Non web plataforms use the native file picker, so there is no need to validate
						  ''
						: // TODO: The check here shouldn't be for which os the UI is running, but for which os the node is running
						os === 'windows'
						? '[^<>:"/|?*\u0000-\u0031]*'
						: '[^\0]+'
				}
				readOnly={!isWeb}
				className={clsx(className, isWeb || 'cursor-pointer')}
				placeholder={
					'Path (e.g., ' +
					// TODO: The check here shouldn't be for which os the UI is running, but for which os the node is running
					(os === 'windows'
						? 'C:\\Users\\john\\Downloads'
						: os === 'macOS'
						? '/Users/clara/Pictures'
						: '/home/emily/Documents') +
					')'
				}
				onClick={(e) => {
					openDirectoryPickerDialog(platform)
						.then((path) => {
							if (path) (e.target as HTMLInputElement).value = path;
						})
						.catch((error) =>
							showAlertDialog({
								title: 'Error',
								value: String(error)
							})
						);
				}}
				{...props}
			/>
		);
	}),
	Advanced: forwardRef<HTMLInputElement, RulesInputProps>((props, ref) => {
		const os = useOperatingSystem(true);
		return (
			<Input
				ref={ref}
				size="md"
				pattern={
					// TODO: The check here shouldn't be for which os the UI is running, but for which os the node is running
					os === 'windows' ? '[^<>:"\u0000-\u0031]*' : '[^\0]+'
				}
				placeholder="Glob (e.g., **/.git)"
				{...props}
			/>
		);
	})
};

type RuleType = keyof typeof RuleTabsInput;

type ParametersFieldType = ControllerRenderProps<
	{ parameters: [RuleType, string][] },
	'parameters'
>;

export interface IndexerRuleEditorProps<T extends IndexerRuleIdFieldType> {
	field?: T;
	editable?: boolean;
}

const ruleKindEnum = z.enum(ruleKinds);

const schema = z.object({
	kind: ruleKindEnum,
	name: z.string().min(3),
	parameters: z
		.array(z.tuple([z.enum(Object.keys(RuleTabsInput) as UnionToTuple<RuleType>), z.string()]))
		.nonempty()
});

type SchemaType = z.infer<typeof schema>;

const REMOTE_ERROR_FORM_FIELD = 'root.serverError';

const removeParameter = <T extends ParametersFieldType>(field: T, index: number) =>
	field.onChange(field.value.slice(0, index).concat(field.value.slice(index + 1)));

export function IndexerRuleEditor<T extends IndexerRuleIdFieldType>({
	field,
	editable
}: IndexerRuleEditorProps<T>) {
	const form = useZodForm({
		schema: schema,
		defaultValues: {
			name: '',
			kind: 'RejectFilesByGlob',
			parameters: []
		}
	});
	const selectValues = ['Name', 'Extension', 'Path', 'Advanced'];
	const formId = useId();
	//mutliple forms

	interface formType {
		id: string;
		ruleType: inputKinds;
		value: any;
	}

	const [forms, setForms] = useState<formType[]>([
		{
			id: uuid4(),
			ruleType: 'Name',
			value: ''
		}
	]);
	const listIndexerRules = useLibraryQuery(['locations.indexer_rules.list']);
	const createIndexerRules = useLibraryMutation(['locations.indexer_rules.create']);

	const addForm = useCallback(() => {
		setForms((prev) => [
			...prev,
			{
				id: uuid4(),
				ruleType: 'Name',
				value: ''
			}
		]);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const deleteForm = useCallback(
		(id: string) => {
			setForms((prev) => prev.filter((form) => form.id !== id));
		},
		[setForms]
	);

	const selectOnChange = (value: inputKinds, formId: string) => {
		const updateForm = forms.map((form) => {
			return form.id === formId ? { ...form, ruleType: value, value: '' } : form;
		});
		setForms(updateForm);
	};

	const inputHandler = (e: ChangeEvent<HTMLInputElement>, formId: string) => {
		const updateForm = forms.map((form) => {
			return form.id === formId ? { ...form, value: e.target.value } : form;
		});
		setForms(updateForm);
	};

	const addIndexerRules = useCallback(
		({ kind, name, parameters }: SchemaType, dryRun = false) =>
			createIndexerRules.mutateAsync({
				kind,
				name,
				dry_run: dryRun,
				parameters: parameters.flatMap(([kind, rule]) => {
					switch (kind) {
						case 'Name':
							return `**/${rule}`;
						case 'Extension':
							// .tar should work for .tar.gz, .tar.bz2, etc.
							return [`**/*${rule}`, `**/*${rule}.*`];
						default:
							return rule;
					}
				})
			}),
		[createIndexerRules]
	);

	const handleAddError = useCallback(
		(error: unknown) => {
			const rspcErrorInfo = extractInfoRSPCError(error);
			if (!rspcErrorInfo || rspcErrorInfo.code === 500) return false;

			const { message } = rspcErrorInfo;

			if (message)
				form.setError(REMOTE_ERROR_FORM_FIELD, { type: 'remote', message: message });

			return true;
		},
		[form]
	);

	useCallbackToWatchForm(
		async (values) => {
			form.clearErrors(REMOTE_ERROR_FORM_FIELD);
			// Only validate with backend if the form is locally valid
			if (!form.formState.isValid) return;
			try {
				await addIndexerRules(values, true);
			} catch (error) {
				handleAddError(error);
			}
		},
		[form, addIndexerRules, handleAddError]
	);

	const indexRules = listIndexerRules.data;
	const {
		formState: { isSubmitting: isFormSubmitting, errors: formErrors }
	} = form;
	return (
		<>
			<div className="flex flex-wrap gap-1">
				{indexRules ? (
					indexRules.map((rule) => (
						<RuleButton
							key={rule.id}
							rule={rule}
							field={field}
							editable={editable}
							disabled={!field}
						/>
					))
				) : (
					<p className={clsx(listIndexerRules.isError && 'text-red-500')}>
						{listIndexerRules.isError
							? 'Error while retriving indexer rules'
							: 'No indexer rules available'}
					</p>
				)}
			</div>
			<Divider className="my-[25px]" />
			{
				// Portal is required for Form because this component can be inside another form element
				createPortal(
					<Form
						id={formId}
						form={form}
						disabled={isFormSubmitting}
						onSubmit={form.handleSubmit(async (values) => {
							try {
								await addIndexerRules(values);
							} catch (error) {
								if (handleAddError(error)) {
									// Reset form to remove isSubmitting state
									form.reset(
										{},
										{ keepValues: true, keepErrors: true, keepIsValid: true }
									);
								} else {
									showAlertDialog({
										title: 'Error',
										value: String(error) || 'Failed to create new indexer rule'
									});
									return;
								}
							}
							form.reset();
							await listIndexerRules.refetch();
						})}
						className="hidden h-0 w-0"
					/>,
					document.body
				)
			}
			<FormProvider {...form}>
				<div className="pb-8">
					<h3 className="mb-[15px] w-full text-sm font-semibold">Name</h3>
					<FormInput
						size="md"
						form={formId}
						placeholder="Name"
						{...form.register('name')}
					/>
					<h3 className="mb-[15px] mt-4 w-full text-sm font-semibold">Rules</h3>
					<Controller
						name="parameters"
						render={({ field }) => (
							<>
								<div
									className={clsx(
										formErrors.parameters && '!ring-1 !ring-red-500',
										'grid space-y-1 rounded-md border border-app-line/60 bg-app-input p-2'
									)}
								>
									<div className="mb-4 grid grid-cols-3 px-3 pt-4 text-sm font-bold">
										<h3 className="pl-2">Type</h3>
										<h3 className="pl-2">Value</h3>
										<h3></h3>
									</div>
									{forms.map((form, index) => {
										return (
											<Card
												key={index}
												className="grid w-full grid-cols-3 items-center gap-3 border-app-line p-0 !px-2 hover:bg-app-box/70"
											>
												<Select
													value={form.ruleType}
													onChange={(value) =>
														selectOnChange(value, form.id)
													}
													className="!h-[34px] !py-0"
													placeholder="Select"
												>
													{selectValues.map((name) => (
														<SelectOption key={name} value={name}>
															{name}
														</SelectOption>
													))}
												</Select>

												<RuleInput
													value={form.value}
													onChange={(e) => inputHandler(e, form.id)}
													kind={form.ruleType}
												/>

												{index !== 0 && (
													<Button
														className="flex w-[30px]
														 items-center justify-self-end !border-app-line"
														variant="gray"
														onClick={() => deleteForm(form.id)}
													>
														<Tooltip label="Delete rule">
															<Trash size={14} />
														</Tooltip>
													</Button>
												)}
											</Card>
										);
									})}

									<Button
										onClick={addForm}
										className="!mt-1 border
										!border-app-line !bg-app-darkBox py-3 !font-bold
										 hover:brightness-105"
									>
										+ New
									</Button>
								</div>

								<ErrorMessage name="parameters" className="mt-1" />
							</>
						)}
						control={form.control}
					/>

					<div className="mb-2 flex flex-row justify-between">
						<div className="mr-2 grow">
							<div className="my-[25px] flex w-full flex-row items-center">
								<label className="grow text-sm font-medium">
									This group of index rules is a Whitelist{' '}
									<Tooltip label="By default, an indexer rule acts as a deny list, causing a location to ignore any file that match its rules. Enabling this will make it act as an allow list, and the location will only display files that match its rules.">
										<Info className="inline" />
									</Tooltip>
								</label>

								<div className="flex items-center gap-2">
									<p className="text-sm text-ink-faint">Whitelist</p>
									<Controller
										name="kind"
										render={({ field }) => (
											<Switch
												onCheckedChange={(checked) => {
													// TODO: This rule kinds are broken right now in the backend and this UI doesn't make much sense for them
													// kind.AcceptIfChildrenDirectoriesArePresent
													// kind.RejectIfChildrenDirectoriesArePresent
													const kind = ruleKindEnum.enum;
													field.onChange(
														checked
															? kind.AcceptFilesByGlob
															: kind.RejectFilesByGlob
													);
												}}
												size="md"
											/>
										)}
										control={form.control}
									/>
									<p className="text-sm text-ink-faint">Blacklist</p>
								</div>
							</div>
							<Divider />
						</div>
					</div>

					<ErrorMessage name={REMOTE_ERROR_FORM_FIELD} variant="large" className="mt-2" />
					<Button
						className="mx-auto mt-[25px] block w-full max-w-[130px]"
						variant="accent"
					>
						Save
					</Button>
				</div>
			</FormProvider>
		</>
	);
}
