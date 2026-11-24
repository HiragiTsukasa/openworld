// MUGEN CITY — system manifest. One `import './path.js';` line per system module.
// Every module self-registers with registerSystem(); init order comes from each system's
// `order`, not from the order of these lines. This file is union-merged (.gitattributes):
// only ever ADD lines, one import per line, no other code.
import './render/renderer.js';
import './render/textures.js';
import './render/materials.js';
import './ui/theme.js';
import './ui/hud.js';
import './ui/touch.js';
import './world/_testscene.js';
