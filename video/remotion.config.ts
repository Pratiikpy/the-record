import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
// The film is typographic: text edges matter more than gradient banding.
Config.setJpegQuality(95);
