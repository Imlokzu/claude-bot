// Metro у монорепо: типовий конфіг шукає модулі лише поряд із застосунком,
// а в npm workspaces вони підняті в корінь. Без цих двох рядків
// @claude-bot/core і react-native не знаходяться.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Дивитися і за межами apps/app — інакше правки в packages/core не
// підхоплюються без перезапуску бандлера.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// Один екземпляр react/react-native на все дерево: два різні ламають хуки.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
