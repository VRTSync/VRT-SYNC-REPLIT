const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

const escape = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const localDirPath = escape(path.join(__dirname, ".local"));

config.resolver = config.resolver || {};
config.resolver.blockList = [
  ...(Array.isArray(config.resolver.blockList)
    ? config.resolver.blockList
    : config.resolver.blockList
    ? [config.resolver.blockList]
    : []),
  new RegExp(`^${localDirPath}[/\\\\].*$`),
  /node_modules[/\\]@unrs[/\\]resolver-binding-win32[^/\\]*(?:[/\\].*)?$/,
  /node_modules[/\\]@unrs[/\\]resolver-binding-darwin[^/\\]*(?:[/\\].*)?$/,
];

module.exports = config;
