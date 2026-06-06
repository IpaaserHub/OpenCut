import type { ParamValues } from "@/params";
import type { CreateTextElement } from "@/timeline/types";

/**
 * Drop the `content` key from a saved-template / source-element param set, so a
 * bulk style application restyles every telop without overwriting each one's own
 * caption text. Pure: returns a new object, leaves the input untouched.
 */
export function stripContent({
	styleParams,
}: {
	styleParams: Partial<ParamValues>;
}): Partial<ParamValues> {
	const { content: _content, ...styleWithoutContent } = styleParams;
	return styleWithoutContent;
}

/**
 * Merge a saved text-template's style/position params onto every generated
 * telop element, so the whole AI short shares one look chosen up front.
 *
 * The template's `content` key is dropped: it's the template's own sample text,
 * and each telop must keep the caption it was generated with. When `styleParams`
 * is empty/undefined the elements are returned with their params unchanged.
 *
 * Pure: reads/writes only `.params`, no wasm/editor access.
 */
export function applyTelopStyle({
	elements,
	styleParams,
}: {
	elements: CreateTextElement[];
	styleParams: Partial<ParamValues>;
}): CreateTextElement[] {
	const styleWithoutContent = stripContent({ styleParams });

	if (Object.keys(styleWithoutContent).length === 0) {
		return elements;
	}

	return elements.map((element) => ({
		...element,
		// `Object.assign` onto a `ParamValues` copy keeps the value type as
		// `ParamValue` (a `{ ...partial }` spread would widen it to include
		// `undefined`); only the partial's present, defined keys are copied over.
		params: Object.assign({ ...element.params }, styleWithoutContent),
	}));
}
