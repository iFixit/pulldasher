const path = require('path');
const webpack = require('webpack')

module.exports = {
   module: {
      rules: [
         {
            test: /\.html$/,
            use: 'raw-loader'
         }
      ]
   },
   resolve: {
      modules: ['public/js', 'views/current', 'node_modules']
   },
   plugins: [
      new webpack.ProvidePlugin({
        $: "jquery",
        jQuery: "jquery"
       })
   ],
   entry: './public/js/main.js',
   output: {
      filename: 'bundle.js',
      path: path.resolve(__dirname, 'dist')
   }
};
