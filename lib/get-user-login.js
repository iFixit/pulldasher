module.exports = function (userApiObject) {
  // All deleted users are replaced with references to this user within
  // the github web app (except in the api, where they are just null).
  // https://github.com/ghost
  return userApiObject ? userApiObject.login : "ghost";
};
