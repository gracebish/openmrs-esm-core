import { basename, dirname } from "path";

export function getSharedDependencies() {
  return require("@openmrs/esm-app-shell/dependencies.json");
}

export function getMainBundle(project: any) {
  const file = project.browser || project.module || project.main;
  return {
    path: file,
    name: basename(file),
    dir: dirname(file),
  };
}

export function getDependentModules(
  root: string,
  host: string,
  peerDependencies: Record<string, string> = {},
  sharedDependencies: Array<string> = []
) {
  const appShellShared = [...getSharedDependencies(), ...sharedDependencies];
  const mifeExpected = Object.keys(peerDependencies);
  const mifeRequired = mifeExpected.filter(
    (name) => !appShellShared.includes(name)
  );

  return mifeRequired.reduce((deps, moduleName) => {
    const project = require(`${root}/node_modules/${moduleName}/package.json`);
    const bundle = getMainBundle(project);
    deps[moduleName] = `${host}/node_modules/${moduleName}/${bundle.path}`;
    return deps;
  }, {});
}
