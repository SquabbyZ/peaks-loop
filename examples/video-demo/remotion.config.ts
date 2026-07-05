import { Config } from "@remotion/cli/config";

Config.setCodec("h264");
Config.setConcurrency(2);
Config.setOverwriteOutput(true);
Config.setChromiumOpenGlRenderer("angle");
