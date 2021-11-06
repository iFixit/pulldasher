const webpack = require('webpack');
const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const definePluginReadFile = require('./webpack-define-read-file');

const relative = (pathPart) => path.resolve(__dirname, pathPart);
const dummyPullsPath = process.env.DUMMY_PULLS;

module.exports = {
   module: {
      rules: [
         {
            // for any file with a suffix of js,jsx,ts,tsx
            test: /\.(jsx?|tsx?)$/,
            // ignore transpiling JavaScript from node_modules as it should be that state
            exclude: /node_modules/,
            // use the babel-loader for transpiling JavaScript to a suitable format
            use: [
               {
                  loader: 'babel-loader',
                  options: {
                     // attach the presets to the loader (most projects use .babelrc file instead)
                     presets: [
                        "@babel/preset-env",
                        ["@babel/preset-react", { runtime: "automatic" }]
                     ]
                  }
               },
               { loader: 'ts-loader' },
               { loader: 'eslint-loader' },
            ],
         }, {
            test: /\.less$/,
            use: [{
               loader: 'style-loader' // creates style nodes from JS strings
            }, {
               loader: 'css-loader'
            }, {
               loader: 'less-loader'
            }]
         },
      ]
   },
   resolve: {
      extensions: ['.ts', '.tsx', '.js', '.less'],
   },
   output: {
      path: relative("dist"),
      publicPath: '/frontend'
   },
   entry: {
      "main": relative("src/index.tsx")
   },
   plugins: [
      new webpack.DefinePlugin({
         "process.env.DUMMY_PULLS": dummyPullsPath ? definePluginReadFile(dummyPullsPath) : null
      }),
      new HtmlWebpackPlugin({
         template: relative("index.html")
      })
   ],
   mode: 'development',
   devtool: 'eval-cheap-module-source-map',
   devServer: {
      open: true,
      openPage: "frontend/"
   }
};
