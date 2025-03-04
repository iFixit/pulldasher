import utils from "../lib/utils.js";
import getLogin from "../lib/get-user-login.js";
import getUserid from "../lib/get-user-id.js";
import db from "../lib/db.js";

/**
 * Builds an object representation of a row in the DB `pull_signatures` table
 * from the Signature object.
 */
class DBSignature {
  constructor(signature) {
    const sigData = signature.data;
    this.data = {
      repo: sigData.repo,
      number: sigData.number,
      user: getLogin(sigData.user),
      userid: getUserid(sigData.user),
      type: sigData.type,
      date: utils.toUnixTime(sigData.created_at),
      active: sigData.active,
      comment_id: sigData.comment_id,
    };
  }

  save() {
    const sigData = this.data;
    const q_insert = "INSERT INTO pull_signatures SET ?";
    return db.query(q_insert, sigData);
  }
}

export default DBSignature;
