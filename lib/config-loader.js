var configPath = process.env.CONFIG_PATH || '../config';
const config = require(configPath);
module.exports  = config;

config.repos = config.repos.map(normalizeRepo);

function normalizeRepo(repo) {
   if (typeof repo == 'string') {
      return {name: repo};
   } else {
      return repo;
   }
}
