const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

const relative = (pathPart) => path.resolve(__dirname, pathPart);

module.exports = {
   module: {
      rules: [
         {
            // for any file with a suffix of js or jsx
            test: /\.jsx?$/,
            // ignore transpiling JavaScript from node_modules as it should be that state
            exclude: /node_modules/,
            // use the babel-loader for transpiling JavaScript to a suitable format
            loader: 'babel-loader',
            options: {
               // attach the presets to the loader (most projects use .babelrc file instead)
               presets: ["@babel/preset-env", "@babel/preset-react"]
            }
         }
      ]
   },
   resolve: {
      modules: [relative('../node_modules')]
   },
   output: {
      path: relative("dist"),
      publicPath: '/frontend'
   },
   entry: {
      "main": relative("src/index.jsx")
   },
   plugins: [
      new HtmlWebpackPlugin()
   ],
   mode: 'development',
   devtool: 'eval-cheap-module-source-map',
   devServer: {
      open: true,
      openPage: "frontend/"
   }
};
