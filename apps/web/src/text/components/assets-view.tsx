"use client";

import { Save, Trash2 } from "lucide-react";
import { DraggableItem } from "@/components/editor/panels/assets/draggable-item";
import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import { Button } from "@/components/ui/button";
import { useEditor } from "@/editor/use-editor";
import type { ParamValues } from "@/params";
import {
	removeTextTemplate,
	saveTextTemplate,
	useTextTemplates,
} from "@/text/templates-store";
import { DEFAULTS } from "@/timeline/defaults";
import { buildTextElement } from "@/timeline/element-utils";
import type { TextElement } from "@/timeline";
import type { MediaTime } from "@/wasm";

const DEFAULT_TEXT_TEMPLATE_ID = "default-text-template";
const FALLBACK_TEXT_CONTENT =
	typeof DEFAULTS.text.element.params.content === "string"
		? DEFAULTS.text.element.params.content
		: "Default text";
const FALLBACK_TEXT_COLOR =
	typeof DEFAULTS.text.element.params.color === "string"
		? DEFAULTS.text.element.params.color
		: "#ffffff";
const FALLBACK_TEXT_FONT_FAMILY =
	typeof DEFAULTS.text.element.params.fontFamily === "string"
		? DEFAULTS.text.element.params.fontFamily
		: "Arial";

function getTextContent({ params }: { params: Partial<ParamValues> }): string {
	return typeof params.content === "string" && params.content.trim()
		? params.content
		: FALLBACK_TEXT_CONTENT;
}

function getTemplateName({
	element,
	index,
}: {
	element: TextElement;
	index: number;
}): string {
	const content = getTextContent({ params: element.params })
		.replace(/\s+/g, " ")
		.trim();
	return content ? content.slice(0, 24) : `テンプレート ${index}`;
}

function buildTextParams({
	params,
}: {
	params: Partial<ParamValues>;
}): ParamValues {
	const nextParams: ParamValues = { ...DEFAULTS.text.element.params };
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined) {
			nextParams[key] = value;
		}
	}
	return nextParams;
}

export function TextView() {
	const editor = useEditor();
	const templates = useTextTemplates();
	const selectedTextElement = useEditor((e) => {
		const selectedElements = e.selection.getSelectedElements();
		if (selectedElements.length !== 1) return null;

		const element = e.timeline.getElementsWithTracks({
			elements: selectedElements,
		})[0]?.element;
		return element?.type === "text" ? element : null;
	});

	const handleSaveSelectedText = () => {
		if (!selectedTextElement) return;

		saveTextTemplate({
			name: getTemplateName({
				element: selectedTextElement,
				index: templates.length + 1,
			}),
			params: selectedTextElement.params,
		});
	};

	const handleAddToTimeline = ({
		currentTime,
		name,
		params,
	}: {
		currentTime: MediaTime;
		name: string;
		params: Partial<ParamValues>;
	}) => {
		const activeScene = editor.scenes.getActiveScene();
		if (!activeScene) return;

		const element = buildTextElement({
			raw: {
				...DEFAULTS.text.element,
				name,
				params: buildTextParams({ params }),
			},
			startTime: currentTime,
		});

		editor.timeline.insertElement({
			element,
			placement: { mode: "auto" },
		});
	};

	return (
		<PanelView
			title="テキスト"
			actions={
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={handleSaveSelectedText}
					disabled={!selectedTextElement}
					aria-label="テンプレートを保存"
					title="テンプレートを保存"
				>
					<Save />
					<span>保存</span>
				</Button>
			}
		>
			<div
				className="grid gap-2"
				style={{ gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))" }}
			>
				<TextTemplateItem
					id={DEFAULT_TEXT_TEMPLATE_ID}
					name="標準テキスト"
					params={DEFAULTS.text.element.params}
					onAddToTimeline={handleAddToTimeline}
				/>
				{templates.map((template) => (
					<TextTemplateItem
						key={template.id}
						id={template.id}
						name={template.name}
						params={template.params}
						onAddToTimeline={handleAddToTimeline}
						onDelete={() => removeTextTemplate({ id: template.id })}
					/>
				))}
			</div>
		</PanelView>
	);
}

function TextTemplateItem({
	id,
	name,
	params,
	onAddToTimeline,
	onDelete,
}: {
	id: string;
	name: string;
	params: Partial<ParamValues>;
	onAddToTimeline: ({
		currentTime,
		name,
		params,
	}: {
		currentTime: MediaTime;
		name: string;
		params: Partial<ParamValues>;
	}) => void;
	onDelete?: () => void;
}) {
	const textParams = buildTextParams({ params });
	const content = getTextContent({ params: textParams });

	return (
		<div className="group/template relative">
			<DraggableItem
				name={name}
				preview={<TextTemplatePreview params={textParams} />}
				dragData={{
					id,
					type: "text",
					name,
					content,
					params: textParams,
				}}
				aspectRatio={1}
				onAddToTimeline={({ currentTime }) =>
					onAddToTimeline({ currentTime, name, params: textParams })
				}
				shouldShowLabel
				containerClassName="w-full"
			/>
			{onDelete && (
				<Button
					type="button"
					variant="destructive-foreground"
					size="icon"
					className="absolute top-1 right-1 size-6 opacity-0 transition-opacity group-hover/template:opacity-100 focus-visible:opacity-100"
					onClick={(event) => {
						event.preventDefault();
						event.stopPropagation();
						onDelete();
					}}
					aria-label={`${name}を削除`}
					title="削除"
				>
					<Trash2 />
				</Button>
			)}
		</div>
	);
}

function TextTemplatePreview({ params }: { params: ParamValues }) {
	const content = getTextContent({ params });
	const backgroundEnabled = params["background.enabled"] === true;
	const backgroundColor =
		typeof params["background.color"] === "string"
			? params["background.color"]
			: DEFAULTS.text.background.color;

	return (
		<div className="bg-accent flex size-full items-center justify-center overflow-hidden rounded-sm p-2">
			<span
				className="max-h-full max-w-full overflow-hidden rounded px-2 py-1 text-xs leading-tight break-all whitespace-pre-line"
				style={{
					color:
						typeof params.color === "string"
							? params.color
							: FALLBACK_TEXT_COLOR,
					fontFamily:
						typeof params.fontFamily === "string"
							? params.fontFamily
							: FALLBACK_TEXT_FONT_FAMILY,
					fontStyle:
						params.fontStyle === "italic" ? "italic" : "normal",
					fontWeight: params.fontWeight === "bold" ? 700 : 400,
					textAlign:
						params.textAlign === "left" ||
						params.textAlign === "right" ||
						params.textAlign === "center"
							? params.textAlign
							: "center",
					backgroundColor: backgroundEnabled ? backgroundColor : "transparent",
				}}
			>
				{content}
			</span>
		</div>
	);
}
