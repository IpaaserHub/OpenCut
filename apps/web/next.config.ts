import type { NextConfig } from "next";
import { withBotId } from "botid/next/config";
import { withContentCollections } from "@content-collections/next";

const frameAncestors = [
	"'self'",
	"https://yt-dir.com",
	"https://*.yt-dir.com",
	"https://tkdir.com",
	"https://*.tkdir.com",
	"https://tk-dir.com",
	"https://*.tk-dir.com",
	...(process.env.VERCEL_ENV === "preview" ? ["https://*.vercel.app"] : []),
	...(process.env.NODE_ENV === "production" ? [] : ["http://localhost:*"]),
];

const nextConfig = {
	compiler: {
		removeConsole: process.env.NODE_ENV === "production",
	},
	reactStrictMode: true,
	productionBrowserSourceMaps: true,
	output: "standalone",
	async headers() {
		return [
			{
				source: "/:path*",
				headers: [
					{
						key: "Content-Security-Policy",
						value: `frame-ancestors ${frameAncestors.join(" ")};`,
					},
				],
			},
		];
	},
	images: {
		remotePatterns: [
			{
				protocol: "https",
				hostname: "plus.unsplash.com",
			},
			{
				protocol: "https",
				hostname: "images.unsplash.com",
			},
			{
				protocol: "https",
				hostname: "images.marblecms.com",
			},
			{
				protocol: "https",
				hostname: "lh3.googleusercontent.com",
			},
			{
				protocol: "https",
				hostname: "avatars.githubusercontent.com",
			},
			{
				protocol: "https",
				hostname: "api.iconify.design",
			},
			{
				protocol: "https",
				hostname: "api.simplesvg.com",
			},
			{
				protocol: "https",
				hostname: "api.unisvg.com",
			},
			{
				protocol: "https",
				hostname: "cdn.brandfetch.io",
			},
		],
	},
} satisfies NextConfig;

export default withContentCollections(withBotId(nextConfig));
