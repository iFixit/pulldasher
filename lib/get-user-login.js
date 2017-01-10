module.exports = function(userApiObject) {
   return userApiObject ? userApiObject.login : "deleted user";
}
