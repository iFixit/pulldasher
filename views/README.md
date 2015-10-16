# Customizing Pulldasher
The files in these directories allow you to customize Pulldasher. I'll describe
the general directory layout, then go into detail on what the files in each part
do.

## Files
As cloned, this directory probably contains three things:

1. a directory named `standard`
2. a file named `layout.html`
3. this file (`README.md`).

The interesting parts are in the `standard` directory.

Within the `standard` directory, you should find the following things:

1. `spec` A directory containing customization JavaScript.
2. `html` A directory containing the templates that are assembled to build the
   main page.
3. `less` A directory containing the LESS styling for the customizable parts.
4. `index.html` The template for the main Pulldasher page layout.
5. `css` A directory containing the compiled version of the LESS.

## Making changes
First, a bit of terminology is in order: We call the small icons that appear on
a pull _indicators_. By similarity of purpose and implementation, we call the
parts that display information like the total number of open pulls and the
number of frozen pulls _page indicators_.

Okay, now a guide on where to look to make a change:
* If you want to change the appearance of part of pulldasher, look at the `less`
  and `html` directories and the `index.html` file.
* If you want to add an indicator to a pull, look in the `indicators.js` file in
  the `spec` directory.
* If you want to add a page indicator, look in the `pageIndicators.js` file in
  `./spec`
* If you want to add a column... yes, it can be done, but it'll take doing.
  You'll need to make changes in both the `./spec/columns.js` file and the
  `index.html` file.
* If you want to customize the behaviour of the collapsible columns, you're
  pretty much out of luck. You'd be better off reimplementing it with column
  triggers (not that that's hard), because it's a bit of a hack the way it is
  currently.
