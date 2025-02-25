import { clone, reduce, mergeDeepRight } from "ramda";
import {
  Config,
  ConfigObject,
  ConfigSchema,
  ExtensionSlotConfig,
  ExtensionSlotConfigObject,
  Type,
} from "../types";
import {
  isArray,
  isBoolean,
  isUuid,
  isNumber,
  isObject,
  isString,
} from "../validators/type-validators";
import {
  ConfigExtensionStore,
  ConfigInternalStore,
  configInternalStore,
  ConfigStore,
  configExtensionStore,
  getConfigStore,
  getExtensionConfigStore,
  getExtensionSlotsConfigStore,
  implementerToolsConfigStore,
  temporaryConfigStore,
} from "./state";
import type {} from "@openmrs/esm-globals";
import { TemporaryConfigStore } from "..";

/**
 * Store setup
 *
 *
 * Set up stores and subscriptions so that inputs get processed appropriately.
 *
 * There are *input* stores and *output* stores. The *input* stores
 * are configInternalStore, temporaryConfigStore, and configExtensionStore. The
 * output stores are set in the `compute...` functions. They are the module
 * config stores, the extension slot config stores (by module), the extension
 * config stores, and the implementer tools config store.
 *
 * This code sets up the subscriptions so that when an input store changes,
 * the correct set of output stores are updated.
 *
 * All `compute...` functions except `computeExtensionConfigs` are pure
 * (or are supposed to be). `computeExtensionConfigs` calls `getGlobalStore`,
 * which creates stores.
 */
computeModuleConfig(
  configInternalStore.getState(),
  temporaryConfigStore.getState()
);
configInternalStore.subscribe((configState) =>
  computeModuleConfig(configState, temporaryConfigStore.getState())
);
temporaryConfigStore.subscribe((tempConfigState) =>
  computeModuleConfig(configInternalStore.getState(), tempConfigState)
);

computeImplementerToolsConfig(
  configInternalStore.getState(),
  temporaryConfigStore.getState()
);
configInternalStore.subscribe((configState) =>
  computeImplementerToolsConfig(configState, temporaryConfigStore.getState())
);
temporaryConfigStore.subscribe((tempConfigState) =>
  computeImplementerToolsConfig(configInternalStore.getState(), tempConfigState)
);

computeExtensionSlotConfigs(
  configInternalStore.getState(),
  temporaryConfigStore.getState()
);
configInternalStore.subscribe((configState) =>
  computeExtensionSlotConfigs(configState, temporaryConfigStore.getState())
);
temporaryConfigStore.subscribe((tempConfigState) =>
  computeExtensionSlotConfigs(configInternalStore.getState(), tempConfigState)
);

computeExtensionConfigs(
  configInternalStore.getState(),
  configExtensionStore.getState(),
  temporaryConfigStore.getState()
);
configInternalStore.subscribe((configState) =>
  computeExtensionConfigs(
    configState,
    configExtensionStore.getState(),
    temporaryConfigStore.getState()
  )
);
configExtensionStore.subscribe((extensionState) =>
  computeExtensionConfigs(
    configInternalStore.getState(),
    extensionState,
    temporaryConfigStore.getState()
  )
);
temporaryConfigStore.subscribe((tempConfigState) =>
  computeExtensionConfigs(
    configInternalStore.getState(),
    configExtensionStore.getState(),
    tempConfigState
  )
);

function computeModuleConfig(
  state: ConfigInternalStore,
  tempState: TemporaryConfigStore
) {
  for (let moduleName of Object.keys(state.schemas)) {
    const config = getConfigForModule(moduleName, state, tempState);
    const moduleStore = getConfigStore(moduleName);
    moduleStore.setState({ loaded: true, config });
  }
}

function computeExtensionSlotConfigs(
  state: ConfigInternalStore,
  tempState: TemporaryConfigStore
) {
  const slotConfigsByModule = getExtensionSlotConfigs(state, tempState);
  for (let [moduleName, extensionSlotConfigs] of Object.entries(
    slotConfigsByModule
  )) {
    const moduleStore = getExtensionSlotsConfigStore(moduleName);
    moduleStore.setState({ loaded: true, extensionSlotConfigs });
  }
}

function computeImplementerToolsConfig(
  state: ConfigInternalStore,
  tempConfigState: TemporaryConfigStore
) {
  const config = getImplementerToolsConfig(state, tempConfigState);
  implementerToolsConfigStore.setState({ config });
}

function computeExtensionConfigs(
  configState: ConfigInternalStore,
  extensionState: ConfigExtensionStore,
  tempConfigState: TemporaryConfigStore
) {
  for (let extension of extensionState.mountedExtensions) {
    const extensionStore = getExtensionConfigStore(
      extension.slotModuleName,
      extension.slotName,
      extension.extensionId
    );
    const config = getExtensionConfig(
      extension.slotModuleName,
      extension.extensionModuleName,
      extension.slotName,
      extension.extensionId,
      configState,
      tempConfigState
    );
    extensionStore.setState({ loaded: true, config });
  }
}

/*
 * API
 *
 */

export function defineConfigSchema(moduleName: string, schema: ConfigSchema) {
  validateConfigSchema(moduleName, schema);
  const state = configInternalStore.getState();
  configInternalStore.setState({
    schemas: { ...state.schemas, [moduleName]: schema },
  });
}

export function provide(config: Config, sourceName = "provided") {
  const state = configInternalStore.getState();
  configInternalStore.setState({
    providedConfigs: [...state.providedConfigs, { source: sourceName, config }],
  });
}

/**
 * A promise-based way to access the config as soon as it is fully loaded.
 * If it is already loaded, resolves the config in its present state.
 *
 * In general you should use the Unistore-based API provided by
 * `getConfigStore`, which allows creating a subscription so that you always
 * have the latest config. If using React, just use `useConfig`.
 *
 * This is a useful function if you need to get the config in the course
 * of the execution of a function.
 *
 * @param moduleName The name of the module for which to look up the config
 */
export function getConfig(moduleName: string): Promise<Config> {
  return new Promise<Config>((resolve) => {
    const store = getConfigStore(moduleName);
    function update(state: ConfigStore) {
      if (state.loaded && state.config) {
        resolve(state.config);
        unsubscribe && unsubscribe();
      }
    }
    update(store.getState());
    const unsubscribe = store.subscribe(update);
  });
}

/**
 * Validate and interpolate defaults for `providedConfig` according to `schema`
 *
 * @param schema  a configuration schema
 * @param providedConfig  an object of config values (without the top-level module name)
 * @param keyPathContext  a dot-deparated string which helps the user figure out where
 *     the provided config came from
 */
export function processConfig(
  schema: ConfigSchema,
  providedConfig: ConfigObject,
  keyPathContext: string,
  devDefaultsAreOn: boolean = false
) {
  validateConfig(schema, providedConfig, keyPathContext);
  const config = setDefaults(schema, providedConfig, devDefaultsAreOn);
  return config;
}

/*
 * Helper functions
 *
 */

/**
 * Returns the configuration for an extension. This configuration is specific
 * to the slot in which it is mounted, and its ID within that slot.
 *
 * The schema for that configuration is the schema for the module in which the
 * extension is defined.
 *
 * @param slotModuleName The name of the module which defines the extension slot
 * @param extensionModuleName The name of the module which defines the extension (and therefore the config schema)
 * @param slotName The name of the extension slot where the extension is mounted
 * @param extensionId The ID of the extension in its slot
 */
function getExtensionConfig(
  slotModuleName: string,
  extensionModuleName: string,
  slotName: string,
  extensionId: string,
  configState: ConfigInternalStore,
  tempConfigState: TemporaryConfigStore
) {
  const providedConfigs = getProvidedConfigs(configState, tempConfigState);
  const slotModuleConfig = mergeConfigsFor(slotModuleName, providedConfigs);
  const configOverride =
    slotModuleConfig?.extensions?.[slotName]?.configure?.[extensionId] ?? {};
  const extensionModuleConfig = mergeConfigsFor(
    extensionModuleName,
    providedConfigs
  );
  const extensionConfig = mergeConfigs([extensionModuleConfig, configOverride]);
  const schema = configState.schemas[extensionModuleName]; // TODO: validate that a schema exists for the module
  validateConfig(schema, extensionConfig, extensionModuleName);
  const config = setDefaults(
    schema,
    extensionConfig,
    configState.devDefaultsAreOn
  );
  delete config.extensions;
  return config;
}

function getImplementerToolsConfig(
  configState: ConfigInternalStore,
  tempConfigState: TemporaryConfigStore
): Record<string, Config> {
  let result = getSchemaWithValuesAndSources(clone(configState.schemas));
  const configsAndSources = [
    ...configState.providedConfigs.map((c) => [c.config, c.source]),
    [tempConfigState.config, "temporary config"],
  ] as Array<[Config, string]>;
  for (let [config, source] of configsAndSources) {
    result = mergeConfigs([result, createValuesAndSourcesTree(config, source)]);
  }
  return result;
}

function getSchemaWithValuesAndSources(schema) {
  if (schema.hasOwnProperty("_default")) {
    return { ...schema, _value: schema._default, _source: "default" };
  } else if (isOrdinaryObject(schema)) {
    return Object.keys(schema).reduce((obj, key) => {
      obj[key] = getSchemaWithValuesAndSources(schema[key]);
      return obj;
    }, {});
  } else {
    // Schema is bad; error will have been logged during schema validation
    return {};
  }
}

function createValuesAndSourcesTree(config: ConfigObject, source: string) {
  if (isOrdinaryObject(config)) {
    return Object.keys(config).reduce((obj, key) => {
      obj[key] = createValuesAndSourcesTree(config[key], source);
      return obj;
    }, {});
  } else {
    return { _value: config, _source: source };
  }
}

function getExtensionSlotConfigs(
  configState: ConfigInternalStore,
  tempConfigState: TemporaryConfigStore
): Record<string, Record<string, ExtensionSlotConfigObject>> {
  const allConfigs = mergeConfigs(
    getProvidedConfigs(configState, tempConfigState)
  );
  const slotConfigPerModule: Record<
    string,
    Record<string, ExtensionSlotConfig>
  > = Object.keys(allConfigs).reduce((obj, key) => {
    if (allConfigs[key]?.extensions) {
      obj[key] = allConfigs[key]?.extensions;
    }
    return obj;
  }, {});
  validateAllExtensionSlotConfigs(slotConfigPerModule);
  return slotConfigPerModule;
}

function validateAllExtensionSlotConfigs(
  slotConfigPerModule: Record<string, Record<string, ExtensionSlotConfig>>
) {
  for (let [moduleName, configBySlotName] of Object.entries(
    slotConfigPerModule
  )) {
    for (let [slotName, config] of Object.entries(configBySlotName)) {
      validateExtensionSlotConfig(config, moduleName, slotName);
    }
  }
}

function validateExtensionSlotConfig(
  config: ExtensionSlotConfig,
  moduleName: string,
  slotName: string
): void {
  const errorPrefix = `Extension slot config '${moduleName}.extensions.${slotName}`;
  const invalidKeys = Object.keys(config).filter(
    (k) => !["add", "remove", "order", "configure"].includes(k)
  );
  if (invalidKeys.length) {
    console.error(
      errorPrefix + `' contains invalid keys '${invalidKeys.join("', '")}'`
    );
  }
  if (config.add) {
    if (
      !Array.isArray(config.add) ||
      !config.add.every((n) => typeof n === "string")
    ) {
      console.error(
        errorPrefix +
          `.add' is invalid. Must be an array of strings (extension IDs)`
      );
    }
  }
  if (config.remove) {
    if (
      !Array.isArray(config.remove) ||
      !config.remove.every((n) => typeof n === "string")
    ) {
      console.error(
        errorPrefix +
          `.remove' is invalid. Must be an array of strings (extension IDs)`
      );
    }
  }
  if (config.order) {
    if (
      !Array.isArray(config.order) ||
      !config.order.every((n) => typeof n === "string")
    ) {
      console.error(
        errorPrefix +
          `.order' is invalid. Must be an array of strings (extension IDs)`
      );
    }
  }
  if (config.configure) {
    if (!isOrdinaryObject(config.configure)) {
      console.error(
        errorPrefix +
          `.configure' is invalid. Must be an object with extension IDs for keys`
      );
    }
  }
}

function getProvidedConfigs(
  configState: ConfigInternalStore,
  tempConfigState: TemporaryConfigStore
): Array<Config> {
  return [
    ...configState.providedConfigs.map((c) => c.config),
    tempConfigState.config,
  ];
}

function validateConfigSchema(
  moduleName: string,
  schema: ConfigSchema,
  keyPath = ""
) {
  const updateMessage = `Please verify that you are running the latest version and, if so, alert the maintainer.`;

  for (const key of Object.keys(schema).filter((k) => !k.startsWith("_"))) {
    const thisKeyPath = keyPath + (keyPath && ".") + key;
    const schemaPart = schema[key] as ConfigSchema;

    if (!isOrdinaryObject(schemaPart)) {
      console.error(
        `${moduleName} has bad config schema definition for key '${thisKeyPath}'. ${updateMessage}`
      );
      continue;
    }

    if (!schemaPart.hasOwnProperty("_default")) {
      // recurse for nested config keys
      validateConfigSchema(moduleName, schemaPart, thisKeyPath);
    }

    const elements = schemaPart._elements;
    if (hasObjectSchema(elements)) {
      validateConfigSchema(moduleName, elements, thisKeyPath + "._elements");
    }

    if (schemaPart._validators) {
      for (let validator of schemaPart._validators) {
        if (typeof validator !== "function") {
          console.error(
            `${moduleName} has invalid validator for key '${thisKeyPath}' ${updateMessage}.` +
              `\n\nIf you're the maintainer: validators must be functions that return either ` +
              `undefined or an error string. Received ${validator}.`
          );
        }
      }
    }

    const valueType = schemaPart._type;
    if (valueType && !Object.values(Type).includes(valueType)) {
      console.error(
        `${moduleName} has invalid type for key '${thisKeyPath}' ${updateMessage}.` +
          `\n\nIf you're the maintainer: the allowed types are ${Object.values(
            Type
          ).join(", ")}. ` +
          `Received '${valueType}'`
      );
    }

    if (
      Object.keys(schemaPart).every((k) =>
        ["_description", "_validators", "_elements", "_type"].includes(k)
      ) &&
      !keyPath.includes("._elements")
    ) {
      console.error(
        `${moduleName} has bad config schema definition for key '${thisKeyPath}'. ${updateMessage}.` +
          `\n\nIf you're the maintainer: all config elements must have a default. ` +
          `Received ${JSON.stringify(schemaPart)}`
      );
    }

    if (
      elements &&
      valueType &&
      ![Type.Array, Type.Object].includes(valueType)
    ) {
      console.error(
        `${moduleName} has bad config schema definition for key '${thisKeyPath}'. ${updateMessage}.` +
          `\n\nIf you're the maintainer: the 'elements' key only works with '_type' equal to 'Array' or 'Object'. ` +
          `Received ${JSON.stringify(valueType)}`
      );
    }
  }
}

function getConfigForModule(
  moduleName: string,
  configState: ConfigInternalStore,
  tempConfigState: TemporaryConfigStore
): ConfigObject {
  if (!configState.schemas.hasOwnProperty(moduleName)) {
    throw Error("No config schema has been defined for " + moduleName);
  }

  const schema = configState.schemas[moduleName];
  const inputConfig = mergeConfigsFor(
    moduleName,
    getProvidedConfigs(configState, tempConfigState)
  );
  validateConfig(schema, inputConfig, moduleName);
  const config = setDefaults(schema, inputConfig, configState.devDefaultsAreOn);
  delete config.extensions;
  return config;
}

function mergeConfigsFor(
  moduleName: string,
  allConfigs: Array<Config>
): ConfigObject {
  const allConfigsForModule = allConfigs
    .map(({ [moduleName]: c }) => c)
    .filter((c) => !!c);

  return mergeConfigs(allConfigsForModule);
}

function mergeConfigs(configs: Array<Config>) {
  const mergeDeepAll = reduce(mergeDeepRight);
  return mergeDeepAll({}, configs) as Config;
}

// Recursively check the provided config tree to make sure that all
// of the provided properties exist in the schema. Run validators
// where present in the schema.
const validateConfig = (
  schema: ConfigSchema,
  config: ConfigObject,
  keyPath = ""
) => {
  for (const key of Object.keys(config)) {
    const value = config[key];
    const thisKeyPath = keyPath + "." + key;
    const schemaPart = schema[key] as ConfigSchema;

    if (!schema.hasOwnProperty(key)) {
      if (key !== "extensions") {
        console.error(
          `Unknown config key '${thisKeyPath}' provided. Ignoring.`
        );
      }

      continue;
    }

    checkType(thisKeyPath, schemaPart._type, value);
    runValidators(thisKeyPath, schemaPart._validators, value);

    if (isOrdinaryObject(value)) {
      // structurally validate only if there's elements specified
      // or there's a `_default` value, which indicates a freeform object
      if (schemaPart._type === Type.Object) {
        validateDictionary(schemaPart, value, thisKeyPath);
      } else if (!schemaPart.hasOwnProperty("_default")) {
        // recurse to validate nested object structure
        validateConfig(schemaPart, value, thisKeyPath);
      }
    } else {
      if (schemaPart._type === Type.Array) {
        validateArray(schemaPart, value, thisKeyPath);
      }
    }
  }
};

function validateDictionary(
  dictionarySchema: ConfigSchema,
  config: ConfigObject,
  keyPath: string
) {
  if (dictionarySchema._elements) {
    for (const key of Object.keys(config)) {
      const value = config[key];
      validateConfig(dictionarySchema._elements, value, `${keyPath}.${key}`);
    }
  }
}

function validateArray(
  arraySchema: ConfigSchema,
  value: ConfigObject,
  keyPath: string
) {
  // if there is an array element object schema, verify that elements match it
  if (hasObjectSchema(arraySchema._elements)) {
    for (let i = 0; i < value.length; i++) {
      validateConfig(arraySchema._elements, value[i], `${keyPath}[${i}]`);
    }
  }

  for (let i = 0; i < value.length; i++) {
    checkType(`${keyPath}[${i}]`, arraySchema._elements?._type, value[i]);
    runValidators(
      `${keyPath}[${i}]`,
      arraySchema._elements?._validators,
      value[i]
    );
  }
}

function checkType(keyPath: string, _type: Type | undefined, value: any) {
  if (_type) {
    const validator: Record<string, Function> = {
      Array: isArray,
      Boolean: isBoolean,
      ConceptUuid: isUuid,
      Number: isNumber,
      Object: isObject,
      String: isString,
      UUID: isUuid,
    };
    runValidators(keyPath, [validator[_type]], value);
  }
}

function runValidators(
  keyPath: string,
  validators: Array<Function> | undefined,
  value: any
) {
  if (validators) {
    try {
      for (let validator of validators) {
        const validatorResult = validator(value);

        if (typeof validatorResult === "string") {
          const valueString =
            typeof value === "object" ? JSON.stringify(value) : value;
          console.error(
            `Invalid configuration value ${valueString} for ${keyPath}: ${validatorResult}`
          );
        }
      }
    } catch (e) {
      console.error(`Skipping invalid validator at "${keyPath}".`);
    }
  }
}

// Recursively fill in the config with values from the schema.
const setDefaults = (
  schema: ConfigSchema,
  inputConfig: Config,
  devDefaultsAreOn: boolean
) => {
  const config = clone(inputConfig);

  if (!schema) {
    return config;
  }

  for (const key of Object.keys(schema)) {
    const configPart = config[key];
    const schemaPart = schema[key] as ConfigSchema;

    // The `schemaPart &&` clause of this `if` statement will only fail
    // if the schema is very invalid. It is there to prevent the app from
    // crashing completely, though it will produce unexpected behavior.
    // If this happens, there should be legible errors in the console from
    // the schema validator.
    if (schemaPart && schemaPart.hasOwnProperty("_default")) {
      // We assume that schemaPart defines a config value, since it has
      // a property `_default`.
      if (!config.hasOwnProperty(key)) {
        const devDefault = schemaPart["_devDefault"] || schemaPart["_default"];

        (config[key] as any) = devDefaultsAreOn
          ? devDefault
          : schemaPart["_default"];
      }

      // We also check if it is an object or array with object elements, in which case we recurse
      const elements = schemaPart._elements;

      if (configPart && hasObjectSchema(elements)) {
        if (schemaPart._type === Type.Array) {
          const configWithDefaults = configPart.map((conf: Config) =>
            setDefaults(elements, conf, devDefaultsAreOn)
          );
          config[key] = configWithDefaults;
        } else if (schemaPart._type === Type.Object) {
          for (let objectKey of Object.keys(configPart)) {
            configPart[objectKey] = setDefaults(
              elements,
              configPart[objectKey],
              devDefaultsAreOn
            );
          }
        }
      }
    } else if (isOrdinaryObject(schemaPart)) {
      // Since schemaPart has no property "_default", if it's an ordinary object
      // (unlike, importantly, the validators array), we assume it is a parent config property.
      // We recurse to config[key] and schema[key]. Default config[key] to {}.
      const selectedConfigPart = config.hasOwnProperty(key) ? configPart : {};

      if (isOrdinaryObject(selectedConfigPart)) {
        config[key] = setDefaults(
          schemaPart,
          selectedConfigPart,
          devDefaultsAreOn
        );
      }
    }
  }

  return config;
};

function hasObjectSchema(
  elementsSchema: Object | undefined
): elementsSchema is ConfigSchema {
  return (
    !!elementsSchema &&
    Object.keys(elementsSchema).filter(
      (e) => !["_default", "_validators"].includes(e)
    ).length > 0
  );
}

function isOrdinaryObject(value) {
  return typeof value === "object" && !Array.isArray(value) && value !== null;
}
