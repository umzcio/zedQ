'use strict';
const path=require('node:path');
const files=Object.freeze({'Arial':'Arial.ttf','Times New Roman':'Times New Roman.ttf','Georgia':'Georgia.ttf','Verdana':'Verdana.ttf','Courier New':'Courier New.ttf','Bradley Hand':'Bradley Hand Bold.ttf','Brush Script MT':'Brush Script.ttf','Comic Sans MS':'Comic Sans MS.ttf'});
const fonts=new Map();
function pdfFont(family){
 if(!Object.hasOwn(files,family))throw Error('Choose a supported PDF font family.');
 if(!fonts.has(family)){
  // Fixed native paths only: neither model output nor document content is a path.
  const filename=path.join('/System/Library/Fonts/Supplemental',files[family]);
  let font;try{font=require('fontkit').openSync(filename)}catch{throw Error(`The ${family} font is unavailable on this Mac. Choose another supported font.`)}
  fonts.set(family,{path:filename,font,name:'document-'+family});
 }
 return fonts.get(family);
}
module.exports={pdfFont};
