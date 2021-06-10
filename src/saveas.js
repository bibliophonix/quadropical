/*
* A stripped down version of FileSaver.js
* By Eli Grey, http://eligrey.com
*
* License : https://github.com/eligrey/FileSaver.js/blob/master/LICENSE.md (MIT)
* source  : http://purl.eligrey.com/github/FileSaver.js
*/

function click (node) {
  try {
    node.dispatchEvent(new MouseEvent('click'))
  } catch (e) {
    console.log("There was an error downloading");
    var evt = document.createEvent('MouseEvents');
    evt.initMouseEvent('click', true, true, window, 0, 0, 0, 80,
                          20, false, false, false, false, 0, null);
    node.dispatchEvent(evt);
  }
}


function saveAs (blob, name) {
  var URL = window.URL || window.webkitURL;
  var a = document.createElement('a');

  a.download = name;
  a.rel = 'noopener'; // tabnabbing

  a.href = URL.createObjectURL(blob);
  setTimeout(function () { URL.revokeObjectURL(a.href) }, 4E4); // 40s
  setTimeout(function () { click(a) }, 0);
}


module.exports = saveAs;
