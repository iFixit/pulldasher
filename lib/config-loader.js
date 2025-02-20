const configPath = process.env.CONFIG_PATH || "../config.js";
const { default: config } = await import(configPath);

export default config;

config.repos = config.repos.map(normalizeRepo);

function normalizeRepo(repo) {
  if (typeof repo == "string") {
    return { name: repo };
  } else {
    return repo;
  }
}
