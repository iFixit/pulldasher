const path = require('path');
const webpack = require('webpack');

const debug = process.env.DEBUG;

module.exports = {
   module: {
      rules: [
         {
            test: /\.js$/,
            exclude: /node_modules/,
            use: [
               {
                  loader: 'babel-loader',
                  options: {
                     presets: [
                        'babel-preset-env'
                     ]
                  }
               },
               'eslint-loader'
            ]
         },
         {
            test: /\.html$/,
            use: 'raw-loader'
         },
         {
            test: /\.less$/,
            use: [
               { loader: 'style-loader'},
               { loader: 'css-loader'},
               { loader: 'less-loader'}
            ]
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
   entry: [
     './public/js/main.js',
     './views/standard/less/themes/day_theme.less'
   ],
   output: {
      filename: 'bundle.js',
      path: path.resolve(__dirname, 'dist')
   },
   mode: debug ? 'development' : 'production'
};
