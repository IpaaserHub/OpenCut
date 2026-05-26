"use client";

import { useSyncExternalStore } from "react";
import type { ParamValue, ParamValues } from "@/params";
import { generateUUID } from "@/utils/id";

const STORAGE_KEY = "opencut-text-templates";

export interface TextTemplate {
	id: string;
	name: string;
	params: Partial<ParamValues>;
	createdAt: number;
}

let cachedTemplates: TextTemplate[] | null = null;
const listeners = new Set<() => void>();

function isParamValue(value: unknown): value is ParamValue {
	return (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	);
}

function isParamValues(value: unknown): value is Partial<ParamValues> {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		Object.values(value).every(isParamValue)
	);
}

function isTextTemplate(value: unknown): value is TextTemplate {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}

	const template = value as Partial<TextTemplate>;
	return (
		typeof template.id === "string" &&
		typeof template.name === "string" &&
		typeof template.createdAt === "number" &&
		isParamValues(template.params)
	);
}

function isTextTemplateArray(value: unknown): value is TextTemplate[] {
	return Array.isArray(value) && value.every(isTextTemplate);
}

function readFromStorage(): TextTemplate[] {
	if (typeof window === "undefined") return [];

	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		return isTextTemplateArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function writeToStorage({ templates }: { templates: TextTemplate[] }): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
	} catch {
		// localStorage may be unavailable or full.
	}
}

function getSnapshot(): TextTemplate[] {
	cachedTemplates ??= readFromStorage();
	return cachedTemplates;
}

function getServerSnapshot(): TextTemplate[] {
	return [];
}

function notify(): void {
	cachedTemplates = null;
	for (const listener of listeners) {
		listener();
	}
}

function onStorageChange(event: StorageEvent): void {
	if (event.key === STORAGE_KEY) notify();
}

function subscribe(listener: () => void): () => void {
	if (listeners.size === 0 && typeof window !== "undefined") {
		window.addEventListener("storage", onStorageChange);
	}
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
		if (listeners.size === 0 && typeof window !== "undefined") {
			window.removeEventListener("storage", onStorageChange);
		}
	};
}

export function useTextTemplates(): TextTemplate[] {
	return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function saveTextTemplate({
	name,
	params,
}: {
	name: string;
	params: Partial<ParamValues>;
}): void {
	writeToStorage({
		templates: [
			...getSnapshot(),
			{
				id: generateUUID(),
				name,
				params: { ...params },
				createdAt: Date.now(),
			},
		],
	});
	notify();
}

export function removeTextTemplate({ id }: { id: string }): void {
	writeToStorage({
		templates: getSnapshot().filter((template) => template.id !== id),
	});
	notify();
}
