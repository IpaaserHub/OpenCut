"use client";

import dynamic from "next/dynamic";

const ProjectsClient = dynamic(() => import("./projects-client"), {
	ssr: false,
	loading: () => <div className="bg-background min-h-screen" />,
});

export default function ProjectsClientLoader() {
	return <ProjectsClient />;
}
