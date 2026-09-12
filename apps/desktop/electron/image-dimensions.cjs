// Read dimensions before decoding, with bounded offsets and forward progress.
function imageDimensions(data){
 if(data.length>=24&&data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&data.toString('ascii',12,16)==='IHDR')return{width:data.readUInt32BE(16),height:data.readUInt32BE(20)};
 if(data.length>=4&&data[0]===255&&data[1]===216){let offset=2;while(offset+4<=data.length){if(data[offset++]!==255)break;while(data[offset]===255)offset++;const marker=data[offset++];if(marker===217||marker===218)break;if(marker===1||marker>=208&&marker<=215)continue;if(offset+2>data.length)break;const length=data.readUInt16BE(offset);if(length<2||offset+length>data.length)break;if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&length>=8)return{width:data.readUInt16BE(offset+5),height:data.readUInt16BE(offset+3)};offset+=length}}
 if(data.length>=30&&data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WEBP'){
  const type=data.toString('ascii',12,16);
  if(type==='VP8X')return{width:data.readUIntLE(24,3)+1,height:data.readUIntLE(27,3)+1};
  if(type==='VP8 '&&data.subarray(23,26).equals(Buffer.from([157,1,42])))return{width:data.readUInt16LE(26)&16383,height:data.readUInt16LE(28)&16383};
  if(type==='VP8L'&&data[20]===47){const bits=data.readUInt32LE(21);return{width:(bits&16383)+1,height:((bits>>>14)&16383)+1}}
 }
 throw Error('Could not read image dimensions. Use a standard PNG, JPG, or WebP image.');
}
module.exports={imageDimensions};
