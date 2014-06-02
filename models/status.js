function Status(data) {
   this.data = {
      sha: data.sha,
      target_url: data.target_url,
      description: data.description,
      state: data.state
   };
}

module.exports = Status;
