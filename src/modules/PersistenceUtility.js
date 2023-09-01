const JSONdb = require("simple-json-db");
const { app, remote } = require("electron");
const path = require("path");
const fs = require("fs");
const browserUtility = require("./BrowserWindowUtility");
const { STATUSES } = require("./constants");

const configDir = (app || remote.app).getPath("userData");
const jsonDbConfig = {
  jsonSpaces: 2,
};

const currentVersion = app.getVersion();

let metaDb, configDb, credentialDb, dataDb;
let browserWindow;

const defaultMeta = {
  configPath: path.join(configDir, "config.json"),
  credentialsPath: path.join(configDir, "credentials.json"),
  sessionDataPath: "",
  version: currentVersion,
};

const defaultConfig = {
  localOnly: true,
  theme: "light",
  defaultColor: "#1976D2FF",
  commentType: "Comment",
  audioCapture: false,
  videoQuality: "high",
  debugMode: false,
  summaryRequired: false,
  ai: {
    enabled: false,
  },
  templates: {
    Screenshot: {
      content: "<p>Testing this</p>",
      text: "Testing this"
    },
    Video: {
      content: "",
      text: ""
    },
    Audio: {
      content: "",
      text: ""
    },
    Note: {
      content: "",
      text: ""
    },
    File: {
      content: "",
      text: ""
    },
    Mindmap: {
      content: "",
      text: ""
    },
  },
  checklist: {
    presession: {
      tasks: [],
      status: false,
    },
    postsession: {
      tasks: [],
      status: false,
    },
  },
  hotkeys: {
    general: {
      cancel: ["ctrl", "c"],
      save: ["ctrl", "s"],
    },
    home: {
      quickTest: ["ctrl", "q"],
      newExploratorySession: ["ctrl", "e"],
      openExploratorySession: ["ctrl", "o"],
    },
    sessionPlanning: {
      title: ["ctrl", "t"],
      charter: ["ctrl", "h"],
      timeLimit: ["ctrl", "l"],
      preconditions: ["ctrl", "p"],
      checklist: ["ctrl", "e"],
      start: "general.save",
    },
    workspace: {
      pause: ["ctrl", "p"],
      resume: "workspace.pause",
      stop: ["ctrl", "h"],
      videoStart: ["ctrl", "v"],
      videoStop: "workspace.videoStart",
      screenshot: ["ctrl", "r"],
      audioStart: ["ctrl", "a"],
      audioStop: "workspace.audioStart",
      note: ["ctrl", "n"],
      mindmap: ["ctrl", "m"],
      changeSource: ["ctrl", "o"],
      createIssue: ["ctrl", "i"],
      back: ["ctrl", "b"],
    }, // Dialogs on workspace use general.save and general.cancel
    evidence: {
      name: ["ctrl", "n"],
      followUp: ["ctrl", "f"],
      comment: ["ctrl", "d"],
      tags: ["ctrl", "t"],
      type: ["ctrl", "y"],
      save: "general.save",
      cancel: "general.cancel",
    },
  },
  version: currentVersion,
};

module.exports.initializeSession = () => {
  const sessionPath = path.join(configDir, "sessions");
  if (!fs.existsSync(sessionPath)) {
    createRootSessionDirectory();
  }

  metaDb = new JSONdb(path.join(configDir, "meta.json"), jsonDbConfig);
  let metadata = {
    version: currentVersion,
  };
  if (metaDb) {
    metadata = this.getMetadata();
  }

  metadata = applyMigrations(
    "meta",
    currentVersion,
    metadata,
  );

  if (!metadata.configPath) {
    metadata.configPath = defaultMeta.configPath;
  }
  configDb = new JSONdb(metadata.configPath, jsonDbConfig);

  const configData = applyMigrations(
    "config",
    currentVersion,
    configDb.JSON(),
  );

  if (!metadata.credentialsPath) {
    metadata.credentialsPath = defaultMeta.credentialsPath;
  }
  credentialDb = new JSONdb(metadata.credentialsPath, jsonDbConfig);

  const credentialData = applyMigrations(
    "credentials",
    currentVersion,
    credentialDb.JSON(),
  );

  let sessionData;
  if (metadata.sessionDataPath) {
    if (fs.existsSync(metadata.sessionDataPath)) {
      dataDb = new JSONdb(metadata.sessionDataPath, jsonDbConfig);
      sessionData = applyMigrations(
        "data",
        currentVersion,
        dataDb.JSON(),
      );
    } else {
      metaDb.set("sessionDataPath", "");
    }
  }

  try {
    metaDb.JSON(metadata)
    metaDb.sync();

    configDb.JSON(configData)
    configDb.sync();

    credentialDb.JSON(credentialData)
    credentialDb.sync();

    if (sessionData) {
      dataDb.JSON(sessionData)
      dataDb.sync();
    }
  } catch (error) {
    console.log(error);
  }
};

const recursivelyMerge = (oldConfig, newConfig) => {
  if (!(oldConfig instanceof Object) || Array.isArray(oldConfig)) {
    if (!oldConfig || oldConfig.constructor !== newConfig.constructor) {
      // Overwriting if the type has changed in the default
      return newConfig;
    }
    return oldConfig;
  }
  if (!(newConfig instanceof Object) || Array.isArray(newConfig)) {
    return newConfig;
  }

  let builtConfig = {};
  for (const key of Object.keys(newConfig)) {
    builtConfig[key] = recursivelyMerge(
      oldConfig[key],
      newConfig[key],
      `path.${key}`
    );
  }
  for (const key of Object.keys(oldConfig)) {
    // Preserving keys in the config but not in default
    if (!Object.keys(newConfig).includes(key)) {
      builtConfig[key] = oldConfig[key];
    }
  }
  return builtConfig;
};

const applyMigrations = (type, newVersion, data) => {
  let oldVersion = data.version || "0.0.0";
  let migratedData = Object.assign(data, {});

  if (newVersion !== oldVersion) {
    // Split newVersion and oldVersion to compare
    let splitNewVersion = newVersion.substring(1).split(".");
    splitNewVersion = splitNewVersion.map((num) => parseInt(num));
    let splitDataVersion = oldVersion.split(".");
    splitDataVersion = splitDataVersion.map((num) => parseInt(num));
    let direction = "up";
    for (let i=0; i < splitNewVersion.length; i++) {
      if (splitNewVersion[i] < splitDataVersion[i]) {
        let direction = "down";
        break;
      }
    }
  
    // Read migration files
    let migrationFiles = fs.readdirSync("./src/modules/migrations/");
    let migrationVersions = migrationFiles.map((fileName) => {
      let temp = fileName.substring(1, fileName.length - 3).split(".");
      return temp.map((num) => parseInt(num));
    });
    // List is in order from lowest to highest 
    if (direction === "down") {
      migrationFiles.reverse();
      migrationVersions.reverse();
    }
  
    // Find the the next migration to run.
    let nextMigrationIndex;
    for (let i=0; i < migrationVersions.length; i++) {
      if (direction === "up") {
        if (migrationVersions[i][0] < splitDataVersion[0]) {
          continue;
        }
        if (migrationVersions[i][0] === splitDataVersion[0]) {
          if (migrationVersions[i][1] < splitDataVersion[1]) {
            continue;
          }
  
          if (migrationVersions[i][1] > splitDataVersion[1]) {
            nextMigrationIndex = i;
            break;
          }
  
          if (migrationVersions[i][1] === splitDataVersion[1]) {
            if (migrationVersions[i][2] <= splitDataVersion[2]) {
              continue;
            } else {
              nextMigrationIndex = i;
              break;
            }
          }
        }
        if (migrationVersions[i][0] > splitDataVersion[0]) {
          nextMigrationIndex = i;
          break;
        }
      } else {
        if (migrationVersions[i][0] > splitDataVersion[0]) {
          continue;
        }
        if (migrationVersions[i][0] === splitDataVersion[0]) {
          if (migrationVersions[i][1] > splitDataVersion[1]) {
            continue;
          }
  
          if (migrationVersions[i][1] < splitDataVersion[1]) {
            nextMigrationIndex = i;
            break;
          }
  
          if (migrationVersions[i][1] === splitDataVersion[1]) {
            if (migrationVersions[i][2] >= splitDataVersion[2]) {
              continue;
            } else {
              nextMigrationIndex = i;
              break;
            }
          }
        }
        if (migrationVersions[i][0] < splitDataVersion[0]) {
          nextMigrationIndex = i;
          break;
        }
      }
    }
  
    // Run migrations in order
    for (
      const migration of migrationFiles.slice(
        nextMigrationIndex, migrationFiles.length
      )
    ) {
      const { migrationStruct } = require(`./migrations/${migration}`);
      if (!migrationStruct[direction][type]) continue;

      // Order of operations here - move first, then functions
      let moveUpMigrations = {};
      let moveLateralMigrations = {};
      let otherMigrations = {};
      for (
        const[key, value] of Object.entries(migrationStruct[direction][type])
      ) {
        if (value === "..") {
          moveUpMigrations[key] = value;
        } else if (value.constructor === String) {
          moveLateralMigrations[key] = value;
        } else {
          otherMigrations[key] = value;
        }
      }
      
      migratedData = migrateKeys(moveUpMigrations, migratedData);
      migratedData = migrateKeys(moveLateralMigrations, migratedData);
      migratedData = migrateKeys(otherMigrations, migratedData);
    }
  }

  let updatedData = migratedData;
  switch (type) {
    case "meta":
      updatedData = recursivelyMerge(migratedData, defaultMeta);
      break;
    case "config":
      updatedData = recursivelyMerge(migratedData, defaultConfig);
      break;
  }
  updatedData.version = newVersion;

  return updatedData;
};

const migrateKeys = (migrations, data) => {
  // Apply migration transformations
  for (
    const [key, value] of Object.entries(migrations)
  ) {
    if (value.constructor === String) {
      if (value === "..") {
        for (
          const [subKey, subValue] of Object.entries(data[key])
        ) {
          data[subKey] = subValue;
        }
      } else if (value !== "") {
        data[value] = data[key];
      }
      delete data[key];
  
    } else if (value.constructor === Function) {
      if (data[key]) {
        data[key] = value(data[key]);
      }
    }
  }
  return data;
};

const createRootSessionDirectory = () => {
  let sessionPaths = [path.join(configDir, "sessions")];
  sessionPaths.forEach((path) => {
    fs.mkdirSync(path, { recursive: true });
  });
};

const removeItemById = (id) => {
  const data = dataDb.get("items");
  const updatedData = data.filter((item) => item.id !== id);
  dataDb.set("items", updatedData);
};

const getItemById = (id) => {
  const data = dataDb.get("items");
  const item = data.find((item) => item.id === id);

  return item;
};

module.exports.createNewSession = (state) => {
  if (dataDb) {
    // TODO - ditching current session, should we save it or do something?
  }
  const sessionDataPath = path.join(
    configDir,
    "sessions",
    state.id,
    "sessionData.json"
  );

  metaDb.set("sessionDataPath", sessionDataPath);
  dataDb = new JSONdb(sessionDataPath, jsonDbConfig);
  dataDb.set("id", state.id);
  delete state.id;
  dataDb.set("state", state);
  dataDb.set("items", []);
  dataDb.set("notes", {
    content: "",
    text: "",
  });
  dataDb.set("version", currentVersion);
};

module.exports.getSessionID = () => {
  try {
    if (dataDb) {
      return dataDb.get("id");
    }
    return "";
  } catch (error) {
    console.log(error);
    return "";
  }
};

module.exports.getState = () => {
  try {
    if (dataDb) {
      return dataDb.get("state");
    }
    return {};
  } catch (error) {
    console.log(error);
    return {};
  }
};

module.exports.updateState = (state) => {
  if (dataDb) {
    let currentState;
    try {
      currentState = dataDb.get("state");
    } catch (error) {
      console.log(error);
      currentState = {};
    }
    dataDb.set("state", {
      ...currentState,
      ...state,
    });
  }
};

module.exports.getItems = () => {
  if (dataDb) {
    try {
      return dataDb.get("items");
    } catch (error) {
      console.log(error);
      return [];
    }
  }
  return [];
};

module.exports.addItem = (item) => {
  try {
    let items = dataDb.get("items") || [];
    items.push(item);
    dataDb.set("items", items);
    browserWindow = browserUtility.getBrowserWindow();
    browserWindow.webContents.send("DATA_CHANGE");
  } catch (error) {
    console.log(error);
  }
};

module.exports.updateItem = (newItem) => {
  try {
    debugger;
    let items = dataDb.get("items").map((item) => {
      if (item.id === newItem.id) {
        return newItem;
      }
      return item;
    });
    dataDb.set("items", items);
    browserWindow = browserUtility.getBrowserWindow();
    browserWindow.webContents.send("DATA_CHANGE");
  } catch (error) {
    console.log(error);
  }
};

module.exports.updateItems = (items) => {
  try {
    dataDb.set("items", items);
    browserWindow = browserUtility.getBrowserWindow();
    browserWindow.webContents.send("DATA_CHANGE");
  } catch (error) {
    console.log(error);
  }
};

module.exports.deleteItems = (ids) => {
  try {
    ids.map((id) => {
      removeItemById(id);
    });
    browserWindow = browserUtility.getBrowserWindow();
    browserWindow.webContents.send("DATA_CHANGE");
    return Promise.resolve({
      status: STATUSES.SUCCESS,
      message: "Element removed successfully",
    });
  } catch (error) {
    return Promise.resolve({ status: STATUSES.ERROR, message: error.message });
  }
};

module.exports.getItemById = (id) => {
  try {
    const data = getItemById(id);
    return data;
  } catch (error) {
    return null;
  }
};

module.exports.getConfig = () => {
  try {
    return configDb.JSON();
  } catch (error) {
    return {};
  }
};

module.exports.updateConfig = (config) => {
  try {
    configDb.JSON(config);
    configDb.sync();
    browserWindow = browserUtility.getBrowserWindow();
    browserWindow.webContents.send("CONFIG_CHANGE");
  } catch (error) {
    console.log(error);
  }
};

module.exports.getCredentials = () => {
  try {
    const {version: _, ...credentials} = credentialDb.JSON();
    return credentials;
  } catch (error) {
    return {};
  }
};

module.exports.updateCredentials = (credentials) => {
  try {
    credentialDb.JSON(credentials);
    credentialDb.sync();
    browserWindow = browserUtility.getBrowserWindow();
    browserWindow.webContents.send("CREDENTIAL_CHANGE");
  } catch (error) {
    console.log(error);
  }
};

module.exports.getMetadata = () => {
  try {
    return metaDb.JSON();
  } catch (error) {
    console.log(`Unable to retrieve metadata: ${error}`);
    return {};
  }
};

module.exports.updateMetadata = (meta) => {
  try {
    for (const [key, value] of Object.entries(meta)) {
      metaDb.set(key, value);
    }
    if (meta.configPath) {
      configDb = new JSONdb(meta.configPath, jsonDbConfig);
    }
    if (meta.credentialsPath) {
      credentialDb = new JSONdb(meta.credentialsPath, jsonDbConfig);
    }
    if (meta.sessionDataPath) {
      dataDb = new JSONdb(meta.sessionDataPath, jsonDbConfig);
    }
    browserWindow = browserUtility.getBrowserWindow();
    browserWindow.webContents.send("META_CHANGE");
  } catch (error) {
    console.log(error);
  }
};

module.exports.getNotes = () => {
  try {
    const data = dataDb.get("notes");
    return data;
  } catch (error) {
    return [];
  }
};

module.exports.updateNotes = (notes) => {
  try {
    dataDb.set("notes", notes);
    browserWindow = browserUtility.getBrowserWindow();
    browserWindow.webContents.send("DATA_CHANGE");
  } catch (error) {
    console.log(error);
  }
};

module.exports.resetData = () => {
  try {
    dataDb.set("items", []);
    dataDb.set("notes", {
      content: "",
      text: "",
    });
    browserWindow = browserUtility.getBrowserWindow();
    browserWindow.webContents.send("DATA_CHANGE");
  } catch (error) {
    console.log(error);
  }
};