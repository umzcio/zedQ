const base=require('../package.json').build;
// Explicit release build only. Local `npm run pack` remains unsigned and has no update feed.
if(!process.env.CSC_NAME)throw new Error('Set CSC_NAME to your Developer ID Application identity.');
module.exports={
 ...base,
 directories:{output:'release-signed'},
 forceCodeSigning:true,
 mac:{...base.mac,identity:process.env.CSC_NAME.replace(/^Developer ID Application:\s*/,''),target:['dmg','zip'],hardenedRuntime:true,notarize:true,signIgnore:['/Contents/Resources/native/']},
 publish:{provider:'github',owner:'umzcio',repo:'zedQ',private:true,releaseType:'draft'},
};
