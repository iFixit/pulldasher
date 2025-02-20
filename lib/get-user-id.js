export default function getUserId(userApiObject) {
  // 10137 is the userid of the "ghost" user
  // https://api.github.com/users/ghost
  // All deleted users are replaced with references to this user within github
  // (except in the api, where they are just null
  return userApiObject ? userApiObject.id : 10137;
}
