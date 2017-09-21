import $ from 'jquery'
import _ from 'underscore'

import pullTemplate from 'html/pull.html'
import restoreTemplate from 'html/restore.html'
import columnTemplate from 'html/column.html'
import indicatorTemplate from 'html/indicator.html'
import globalIndicatorTemplate from 'html/global_indicator.html'

var templates = {
   pull: pullTemplate,
   restore: restoreTemplate,
   column: columnTemplate,
   indicator: indicatorTemplate,
   global_indicator: globalIndicatorTemplate
};

debugger;

var compiledTemplates = {};

export default {
   get: function(name) {
      if (!compiledTemplates[name]) {
         compiledTemplates[name] = _.template(
            templates[name],
            null,
            { variable: name }
         );
      }
      return compiledTemplates[name];
   },
   /**
    * Renders a template with provided data and appends the resulting node
    * to the end of the JQuery object container.
    *
    * @return Returns a jQuery object representing the result of the render.
    */
   renderIntoContainer: function renderInto(template, data, container) {
      var templateFunction = this.get(template);
      var html = templateFunction(data);
      var node = $(html);
      container.append(node);

      return node;
   }
};
