"use client";

import dynamic from "next/dynamic";

const EditorClient = dynamic(() => import("./editor-client"), {
	ssr: false,
	loading: () => <div className="bg-background h-screen w-screen" />,
});

export default function EditorClientLoader() {
	return <EditorClient />;
}
