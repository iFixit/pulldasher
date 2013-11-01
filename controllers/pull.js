module.exports = function(pullManager) {
   var i=2;
   return {
      index: function (req, res) {
         //include logic for grabbing pulls
         console.log(req.user); 
         res.send(req.user);
         //res.render('/home/index');
      },

      add: function(req, res) {
         pullManager.addPull({
            id : i,
            name: "Pull #" + i,
            href: "https://github.com/chpatton013/pulldash",
            buildStatus: "success",
            buildLog: "https://google.com"
         });
         res.send("added pull #" + i);
         i++;
      }
   }
}
