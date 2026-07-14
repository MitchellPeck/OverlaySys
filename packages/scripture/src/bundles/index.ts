import kjv from "./kjv.json";
import web from "./web.json";
import type { BundleFile } from "../providers/bundled";

export const KJV_BUNDLE = kjv as BundleFile;
export const WEB_BUNDLE = web as BundleFile;
export const ALL_BUNDLES: BundleFile[] = [KJV_BUNDLE, WEB_BUNDLE];
