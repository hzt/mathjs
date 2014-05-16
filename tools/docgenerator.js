/**
 * This is a little tool to generate reference documentation of all math.js
 * functions under ./lib/functions. This is NO generic solution.
 *
 * The tool can parse documentation information from the block comment in the
 * functions code, and generate a markdown file with the documentation.
 */
var fs = require('fs'),
    glob = require('glob'),
    mkdirp = require('mkdirp'),
    gutil = require('gulp-util');

/**
 * Extract JSON documentation from the comments in a file with JavaScript code
 * @param {String} name    Function name
 * @param {String} code    javascript code containing a block comment
 *                         describing a math.js function
 * @return {Object} doc    json document
 */
function generateDoc(name, code) {
  // get block comment from code
  var match = /\/\*([^*]|[\r\n]|(\*+([^*/]|[\r\n])))*\*+\//.exec(code);

  // get text content inside block comment
  var comment = match[0].replace('/**', '')
      .replace('*/', '')
      .replace(/\n\s*\* ?/g, '\n')
      .replace(/\r/g, '');

  var lines = comment.split('\n'),
      line = '';

  // get next line
  function next () {
    line = lines.shift();
  }

  // returns true if current line is empty
  function empty() {
    return !line || !line.trim();
  }

  // returns true if there still is a current line
  function exists() {
    return line !== undefined;
  }

  // returns true if current line is a header like 'Syntax:'
  function isHeader() {
    return /^(Name|Syntax|Description|Examples|See also)/i.test(line);
  }

  // returns true if the current line starts with an annotation like @param
  function isAnnotation() {
    return /^@/.test(line);
  }

  function skipEmptyLines () {
    while (exists() && empty()) next();
  }

  function parseDescription () {
    var description = '';

    while (exists() && !isHeader() && !isAnnotation()) {
      if (empty()) {
        description += '\n\n';
      }
      else {
        var last = description.charAt(description.length - 1);
        var first = line.charAt(0);
        if ((first == '-' || first == '+') && last != '\n') {
          // markdown list
          description += '\n';
          // TODO: numbered list
        }
        else {
          if (last && last != '\n') description += ' ';
        }
      }
      description += line;

      next();
    }

    // remove trailing returns
    while (description.charAt(description.length - 1) == '\n') {
      description = description.substring(0, description.length - 1);
    }

    doc.description = description;
  }

  function parseSyntax() {
    if (/^syntax/i.test(line)) {
      next();
      skipEmptyLines();

      while (exists() && !empty()) {
        doc.syntax.push(line.trim());
        next();
      }

      skipEmptyLines();

      return true;
    }
    return false;
  }

  function parseExamples() {
    if (/^example/i.test(line)) {
      next();
      skipEmptyLines();

      while (exists() && (empty() || line.charAt(0) == ' ')) {
        doc.examples.push(line.trim());
        next();
      }

      if (doc.examples[doc.examples.length - 1].trim() == '') doc.examples.pop();

      skipEmptyLines();

      return true;
    }
    return false;
  }

  function parseSeeAlso() {
    if (/^see also/i.test(line)) {
      next();
      skipEmptyLines();

      while (exists() && !empty()) {
        var names = line.split(',');
        doc.seeAlso = doc.seeAlso.concat(names.map(function (name) {
          return name.trim();
        }));
        next();
      }

      skipEmptyLines();

      return true;
    }
    return false;
  }

  function parseParameters() {
    var count = 0;
    do {
      var match = /\s*@param\s*{(.*)}\s*\[?(\w*)\]?\s*(.*)?$/.exec(line);
      if (match) {
        next();

        count++;
        var annotation = {
          name: match[2] || '',
          description: (match[3] || '').trim(),
          types: match[1].split('|').map(function (t) {
            return t.trim();
          })
        };
        doc.parameters.push(annotation);

        // TODO: this is an ugly hack to extract the default value
        var index = annotation.description.indexOf(']');
        if (index != -1) {
          var defaultValue = annotation.description.substring(1, index).trim();
          annotation.description = annotation.description.substring(index + 1).trim() +
              ' Default value: ' + defaultValue;
        }

        // multi line description
        while (exists() && !empty() && /^\s{6}/.test(line)) {
          annotation.description += ' ' + line.trim();
          next();
        }
      }
    } while (match);

    return count > 0;
  }

  function parseReturns() {
    var match = /\s*@returns?\s*{(.*)}\s*(.*)?$/.exec(line);
    if (match) {
      next();

      doc.returns = {
        description: match[2] || '',
        types: match[1].split('|').map(function (t) {
          return t.trim();
        })
      };

      // multi line description
      while (exists() && !empty() && /^\s{6}/.test(line)) {
        doc.returns.description += ' ' + line.trim();
        next();
      }

      return true;
    }
    return false;
  }

  // initialize doc
  var doc = {
    name: name,
    description: '',
    syntax: [],
    examples: [],
    seeAlso: [],
    parameters: [],
    returns: null
  };

  next();
  skipEmptyLines();
  parseDescription();

  do {
    skipEmptyLines();

    var handled = parseSyntax() ||
        parseExamples() ||
        parseSeeAlso() ||
        parseParameters() ||
        parseReturns();

    if (!handled) {
      // skip this line, no one knows what to do with it
      next();
    }
  } while (exists());

  return doc;
}

/**
 * Validate whether all required fields are available in given doc
 * @param {Object} doc
 * @return {String[]} issues
 */
function validateDoc (doc) {
  var issues = [];

  if (!doc.name) {
    issues.push('name missing in document');
  }

  if (!doc.description) {
    issues.push('function "' + doc.name + '": description missing');
  }

  if (!doc.syntax || doc.syntax.length == 0) {
    issues.push('function "' + doc.name + '": syntax missing');
  }

  if (!doc.examples || doc.examples.length == 0) {
    issues.push('function "' + doc.name + '": examples missing');
  }

  if (doc.parameters && doc.parameters.length) {
    doc.parameters.forEach(function (param, index) {
      if (!param.name || !param.name.trim()) {
        issues.push('function "' + doc.name + '": name missing of parameter ' + index + '');
      }
      if (!param.description || !param.description.trim()) {
        issues.push('function "' + doc.name + '": description missing for parameter ' + (param.name || index));
      }
      if (!param.types || !param.types.length) {
        issues.push('function "' + doc.name + '": types missing for parameter ' + (param.name || index));
      }
    });
  }
  else {
    issues.push('function "' + doc.name + '": parameters missing');
  }

  if (doc.returns) {
    if (!doc.returns.description || !doc.returns.description.trim()) {
      issues.push('function "' + doc.name + '": description missing of returns');
    }
    if (!doc.returns.types || !doc.returns.types.length) {
      issues.push('function "' + doc.name + '": types missing of returns');
    }
  }
  else {
    issues.push('function "' + doc.name + '": returns missing');
  }

  if (!doc.seeAlso || doc.seeAlso.length == 0) {
    issues.push('function "' + doc.name + '": seeAlso missing');
  }

  return issues;
}

/**
 * Generate markdown
 * @param {Object} doc          A JSON object generated with generateDoc()
 * @param {Object} functions    All functions, used to generate correct links
 *                              under seeAlso
 * @returns {string} markdown   Markdown contents
 */
function generateMarkdown (doc, functions) {
  var text = '';

  // TODO: should escape HTML characters in text

  text += '# Function ' + doc.name + '\n\n';

  text += doc.description + '\n\n\n';

  if (doc.syntax && doc.syntax.length) {
    text += '## Syntax\n\n' +
        '```js\n' +
        doc.syntax.join('\n') +
        '\n```\n\n';
  }

  text += '### Parameters\n\n' +
      'Parameter | Type | Description\n' +
      '--------- | ---- | -----------\n' +
      doc.parameters.map(function (p) {
        return '`' + p.name + '` | ' +
            (p.types ? p.types.join(' &#124; ') : '') + ' | ' +
            p.description
      }).join('\n') +
      '\n\n';

  if (doc.returns) {
    text += '### Returns\n\n' +
        'Type | Description\n' +
        '---- | -----------\n' +
        (doc.returns.types ? doc.returns.types.join(' &#124; ') : '') + ' | ' + doc.returns.description +
        '\n\n\n';
  }

  if (doc.examples && doc.examples.length) {
    text += '## Examples\n\n' +
        '```js\n' +
        doc.examples.join('\n') +
        '\n```\n\n\n';
  }

  if (doc.seeAlso && doc.seeAlso.length) {
    text += '## See also\n\n' +
        doc.seeAlso.map(function (name) {
          return '[' + name + '](' + name + '.md)';
        }).join(',\n') +
        '\n';
  }

  text += '\n\n';

  text += '<!-- Note: This file is automatically generated from source code comments. Changes made in this file will be overridden. -->\n';

  return text;
}

/**
 * Iterate over all source files and generate markdown documents for each of them
 * @param {String} inputPath
 * @param {String} outputPath
 */
function iteratePath (inputPath, outputPath) {
  if (!fs.existsSync(outputPath)) {
    mkdirp.sync(outputPath);
  }

  glob(inputPath + '**/*.js', null, function (err, files) {
    // generate path information for each of the files
    var functions = {};
    files.forEach(function (fullPath) {
      var name = fullPath.match(/\/(\w*)\.js/)[1],
          relativePath = fullPath.substring(inputPath.length);

      functions[name] = {
        name: name,
        category: relativePath.match(/^(.*)\//)[1],
        fullPath: fullPath,
        relativePath: relativePath
      };
    });

    // loop over all files, generate a doc for each of them
    var issues = [];
    for (var name in functions) {
      if (functions.hasOwnProperty(name)) {
        var fn = functions[name];

        var code = fs.readFileSync(fn.fullPath);
        var doc = generateDoc(name, code);

        issues = issues.concat(validateDoc(doc));

        var markdown = generateMarkdown(doc, functions);

        fs.writeFileSync(outputPath + '/' + fn.name + '.md', markdown);
      }
    }

    // TODO: also generate index pages

    // output all issues
    if (issues.length) {
      issues.forEach(function (issue) {
        gutil.log('Warning: ' + issue);
      });
      gutil.log(issues.length + ' warnings');
    }
  });
}

// exports
exports.iteratePath = iteratePath;
exports.generateDoc = generateDoc;
exports.validateDoc = validateDoc;
exports.generateMarkdown = generateMarkdown;