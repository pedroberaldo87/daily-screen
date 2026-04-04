// ═══════════════════════════════════════════════
// Icon Picker — Emoji gallery with categories
// ═══════════════════════════════════════════════

// Keyword map for search (PT-BR + EN)
const EMOJI_KEYWORDS = {
  '💊': 'remedio remédio pilula pílula medicamento medicine pill drug comprimido capsula cápsula',
  '💉': 'seringa injeção injecao vacina syringe injection vaccine agulha',
  '🩺': 'estetoscopio estetoscópio médico medico doctor stethoscope consulta',
  '🩹': 'curativo bandaid bandage adesivo ferida machucado',
  '🧬': 'dna genética genetica gene biologia',
  '🧪': 'tubo ensaio laboratorio laboratório test tube lab suplemento supplement',
  '🔬': 'microscopio microscópio ciência ciencia science',
  '🫀': 'coração coracao heart órgão orgao',
  '🫁': 'pulmão pulmao lung respirar',
  '🧠': 'cérebro cerebro brain mente mind pensar',
  '🦷': 'dente tooth dental dentista',
  '🦴': 'osso bone esqueleto cálcio calcio',
  '👁️': 'olho eye visão visao ver colírio colirio',
  '🩸': 'sangue blood exame gota',
  '🩻': 'raio x radiografia xray',
  '☀️': 'sol sun vitamina d luz dia manhã manha',
  '🌙': 'lua moon noite night dormir sleep',
  '⭐': 'estrela star favorito',
  '🌡️': 'termometro termômetro temperatura febre fever',
  '💧': 'agua água water gota hidratação hidratar beber drink',
  '🧊': 'gelo ice frio cold',
  '🔥': 'fogo fire quente hot',
  '❄️': 'neve snow frio cold gelo',
  '🌈': 'arco iris arco-íris rainbow',
  '🍎': 'maça maçã apple fruta fruit vermelho',
  '🍊': 'laranja orange vitamina c citrus',
  '🍋': 'limão limao lemon citrus',
  '🥑': 'abacate avocado gordura boa',
  '🥦': 'brócolis brocolis broccoli vegetal',
  '🥕': 'cenoura carrot vitamina a',
  '🧄': 'alho garlic imunidade',
  '🫚': 'gengibre ginger',
  '🥛': 'leite milk cálcio calcio',
  '🧃': 'suco juice caixinha',
  '🍵': 'chá cha tea infusão',
  '☕': 'café cafe coffee',
  '🥤': 'copo drink bebida shake',
  '💪': 'músculo musculo muscle forte strong exercício exercicio gym academia treino creatina',
  '🏃': 'corrida correr run running exercicio exercício cardio',
  '🧘': 'yoga meditação meditacao meditar relax calma',
  '🚶': 'caminhada caminhar walk andar passeio',
  '🏋️': 'peso weight musculação musculacao gym academia halter',
  '🚴': 'bicicleta bike ciclismo cycling pedal',
  '🧗': 'escalada climbing',
  '🤸': 'ginástica ginastica gymnastics alongamento',
  '🏊': 'natação natacao swim swimming piscina',
  '⚡': 'energia energy raio lightning rápido rapido',
  '📋': 'lista list checklist lembrete reminder tarefa task',
  '📌': 'pin fixar importante lembrete',
  '📝': 'nota note escrever write anotação anotacao',
  '✅': 'check feito done concluído concluido ok sim yes',
  '❌': 'errado wrong não nao cancelar',
  '⏰': 'alarme alarm despertador hora time relógio relogio',
  '🔔': 'sino bell notificação notificacao alerta alert lembrete',
  '🗓️': 'calendário calendario calendar data date agenda',
  '📅': 'calendário calendario calendar data date',
  '📎': 'clipe clip anexo',
  '🏠': 'casa home lar moradia',
  '🚗': 'carro car automóvel automovel dirigir',
  '🔑': 'chave key porta',
  '💳': 'cartão cartao card crédito credito débito debito',
  '📱': 'celular telefone phone mobile',
  '💻': 'computador computer laptop notebook',
  '🎒': 'mochila backpack bolsa bag escola',
  '👔': 'gravata tie roupa trabalho formal',
  '👟': 'tênis tenis sapato shoe sneaker',
  '🧥': 'casaco coat jaqueta jacket frio',
  '🪥': 'escova dente toothbrush escovar higiene dental',
  '🧴': 'loção locao creme protetor hidratante cosmético cosmetico',
  '🧼': 'sabão sabao sabonete soap lavar',
  '🪒': 'barbear shave razor gilete',
  '💈': 'barbearia barber cabelo',
  '🚿': 'chuveiro shower banho',
  '🛁': 'banheira bath banho',
  '🛒': 'carrinho compras shopping cart mercado supermercado',
  '💰': 'dinheiro money grana cash',
  '🏦': 'banco bank financeiro',
  '📦': 'caixa box pacote package encomenda',
  '✉️': 'carta email correio mail',
  '📞': 'telefone phone ligar call',
  '😴': 'dormir sleep sono soneca',
  '🛌': 'cama bed dormir sleep descanso',
  '🌅': 'nascer sol sunrise amanhecer manhã manha',
  '🌇': 'pôr sol por sol sunset entardecer tarde',
  '🐟': 'peixe fish ômega omega 3 atum salmão salmao',
  '🐶': 'cachorro dog cão cao pet',
  '🐱': 'gato cat pet',
  '🐦': 'pássaro passaro bird',
  '❤️': 'coração coracao heart amor love',
  '🧡': 'coração coracao heart laranja orange',
  '💛': 'coração coracao heart amarelo yellow',
  '💚': 'coração coracao heart verde green',
  '💙': 'coração coracao heart azul blue',
  '💜': 'coração coracao heart roxo purple',
  '🖤': 'coração coracao heart preto black',
  '🏁': 'bandeira flag chegada finish',
  '🚩': 'bandeira flag alerta aviso',
  '🇧🇷': 'brasil brazil bandeira flag',
  '🍇': 'uva grape fruta roxo',
  '🍉': 'melancia watermelon fruta',
  '🍌': 'banana fruta',
  '🍍': 'abacaxi pineapple fruta',
  '🥭': 'manga mango fruta',
  '🍑': 'pêssego pessego peach fruta',
  '🍒': 'cereja cherry fruta',
  '🍓': 'morango strawberry fruta',
  '🫐': 'mirtilo blueberry fruta berry',
  '🥝': 'kiwi fruta',
  '🍅': 'tomate tomato',
  '🌽': 'milho corn',
  '🧅': 'cebola onion',
  '🍄': 'cogumelo mushroom',
  '🥜': 'amendoim peanut castanha nut',
  '🌰': 'castanha chestnut noz',
  '🍞': 'pão pao bread',
  '🧀': 'queijo cheese',
  '🥚': 'ovo egg',
  '🍳': 'frigideira frying pan ovo frito cozinhar',
  '🥗': 'salada salad verde saudável saudavel',
  '🍚': 'arroz rice',
  '🍕': 'pizza',
  '🍔': 'hambúrguer hamburger burger',
  '🌮': 'taco mexicano',
  '🍦': 'sorvete ice cream',
  '🍪': 'biscoito cookie',
  '🎂': 'bolo cake aniversário aniversario',
  '🍫': 'chocolate candy doce',
  '🍬': 'bala candy doce',
  '🍷': 'vinho wine',
  '🍺': 'cerveja beer',
  '⌚': 'relógio relogio watch hora time',
  '🔍': 'lupa busca search procurar',
  '💡': 'lâmpada lampada light bulb ideia idea',
  '📚': 'livros books estudar study ler read',
  '✏️': 'lápis lapis pencil escrever write',
  '✂️': 'tesoura scissors cortar cut',
  '🔒': 'cadeado lock segurança seguranca trancado',
  '🔓': 'desbloqueado unlock aberto',
  '🔧': 'ferramenta wrench tool consertar fix',
  '⚙️': 'engrenagem gear configuração configuracao settings',
  '🧲': 'ímã ima magnésio magnesio magnet',
  '🧰': 'caixa ferramentas toolbox',
  '♻️': 'reciclar recycle reciclagem',
};

const ICON_CATEGORIES = {
  rotina: {
    label: '⭐ Rotina',
    icons: [
      '💊','💉','🩺','🩹','🧬','🧪','🔬','🫀','🫁','🧠','🦷','🦴','👁️','🩸','🩻',
      '☀️','🌙','⭐','🌡️','💧','🧊','🔥','❄️','🌈',
      '🍎','🍊','🍋','🥑','🥦','🥕','🧄','🫚','🥛','🧃','🍵','☕','🥤','🫗',
      '💪','🏃','🧘','🚶','🏋️','🚴','🧗','🤸','🏊','⚡',
      '📋','📌','📝','✅','❌','⏰','🔔','🗓️','📅','📎',
      '🏠','🚗','🔑','💳','📱','💻','🎒','👔','👟','🧥',
      '🪥','🧴','🧼','🪒','💈','🚿','🛁',
      '🛒','💰','🏦','📦','✉️','📞',
      '😴','🛌','☕','🌅','🌇',
    ],
  },
  rostos: {
    label: '😀 Rostos',
    icons: [
      '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃',
      '😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙',
      '🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🫢',
      '🫣','🤫','🤔','🫡','🤐','🤨','😐','😑','😶','🫥',
      '😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴',
      '😷','🤒','🤕','🤢','🤮','🥵','🥶','🥴','😵','🤯',
      '🤠','🥳','🥸','😎','🤓','🧐','😕','🫤','😟','🙁',
      '😮','😯','😲','😳','🥺','🥹','😦','😧','😨','😰',
      '😥','😢','😭','😱','😖','😣','😞','😓','😩','😫',
      '🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','💩',
      '🤡','👹','👺','👻','👽','👾','🤖',
      '👋','🤚','🖐️','✋','🖖','🫱','🫲','🫳','🫴','👌',
      '🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙','👈','👉',
      '👆','🖕','👇','☝️','🫵','👍','👎','✊','👊','🤛',
      '🤜','👏','🙌','🫶','👐','🤲','🤝','🙏',
    ],
  },
  natureza: {
    label: '🌿 Natureza',
    icons: [
      '🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯',
      '🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐒','🐔',
      '🐧','🐦','🐤','🐣','🦆','🦅','🦉','🦇','🐺','🐗',
      '🐴','🦄','🐝','🪱','🐛','🦋','🐌','🐞','🐜','🪰',
      '🪲','🪳','🦟','🦗','🕷️','🦂','🐢','🐍','🦎','🦖',
      '🦕','🐙','🦑','🦐','🦞','🦀','🪸','🐡','🐠','🐟',
      '🐬','🐳','🐋','🦈','🐊','🐅','🐆','🦓','🫏','🦍',
      '🦧','🐘','🦛','🦏','🐪','🐫','🦒','🦘','🦬','🐃',
      '🐂','🐄','🐎','🐖','🐏','🐑','🦙','🐐','🦌','🫎',
      '🐕','🐩','🦮','🐈','🐓','🦃','🦤','🦚','🦜','🦢',
      '🌵','🎄','🌲','🌳','🌴','🪵','🌱','🌿','☘️','🍀',
      '🎍','🪴','🎋','🍃','🍂','🍁','🪻','🌺','🌸','💐',
      '🌷','🪷','🌹','🥀','🌻','🌼','🌾','🫘',
      '☀️','🌤️','⛅','🌥️','☁️','🌦️','🌧️','⛈️','🌩️','🌨️',
      '❄️','🌬️','💨','🌪️','🌫️','🌈','☔','⚡','🔥','💧',
      '🌊','🏔️','⛰️','🌋','🏜️','🏝️',
    ],
  },
  comida: {
    label: '🍔 Comida',
    icons: [
      '🍇','🍈','🍉','🍊','🍋','🍌','🍍','🥭','🍎','🍏',
      '🍐','🍑','🍒','🍓','🫐','🥝','🍅','🫒','🥥',
      '🥑','🍆','🥔','🥕','🌽','🌶️','🫑','🥒','🥬','🥦',
      '🧄','🧅','🫚','🍄','🥜','🫘','🌰',
      '🍞','🥐','🥖','🫓','🥨','🥯','🥞','🧇','🧀','🍖',
      '🍗','🥩','🥓','🍔','🍟','🍕','🌭','🥪','🌮','🌯',
      '🫔','🥙','🧆','🥚','🍳','🥘','🍲','🫕','🥣','🥗',
      '🍿','🧈','🧂','🥫','🍱','🍘','🍙','🍚','🍛','🍜',
      '🍝','🍠','🍢','🍣','🍤','🍥','🥮','🍡','🥟','🥠',
      '🥡','🦀','🦞','🦐','🦑','🦪',
      '🍦','🍧','🍨','🍩','🍪','🎂','🍰','🧁','🥧','🍫',
      '🍬','🍭','🍮','🍯',
      '🍼','🥛','☕','🫖','🍵','🧋','🍶','🍾','🍷','🍸',
      '🍹','🍺','🍻','🥂','🥃','🫗','🥤','🧊','🧃',
    ],
  },
  objetos: {
    label: '🔧 Objetos',
    icons: [
      '⌚','📱','💻','⌨️','🖥️','🖨️','🖱️','💽','💾','📀',
      '🎥','📸','📹','📼','🔍','🔎','🕯️','💡','🔦','🏮',
      '🪔','📔','📕','📖','📗','📘','📙','📚','📓','📒',
      '📃','📜','📄','📰','🗞️','📑','🔖','🏷️','💰','🪙',
      '💴','💵','💶','💷','💸','💳','🧾','💹',
      '✉️','📧','📨','📩','📤','📥','📦','📫','📪','📬',
      '📭','📮','🗳️','✏️','✒️','🖊️','🖋️','📝','💼','📁',
      '📂','🗂️','📅','📆','🗒️','🗓️','📇','📈','📉','📊',
      '📋','📌','📍','📎','🖇️','📏','📐','✂️','🗃️','🗄️',
      '🗑️','🔒','🔓','🔏','🔐','🔑','🗝️',
      '🔨','🪓','⛏️','⚒️','🛠️','🗡️','⚔️','💣','🪃','🏹',
      '🛡️','🪚','🔧','🪛','🔩','⚙️','🗜️','⚖️','🦯','🔗',
      '⛓️','🪝','🧰','🧲',
      '🧪','🧫','🧬','🔬','🔭','📡',
      '💊','🩸','🩹','🩺','🩻','🩼',
      '🚪','🛗','🪞','🪟','🛏️','🛋️','🪑','🚽','🪠','🚿',
      '🛁','🪤','🪒','🧴','🧷','🧹','🧺','🧻','🪣','🧼',
      '🫧','🪥','🧽','🧯','🛒',
    ],
  },
  simbolos: {
    label: '🔣 Símbolos',
    icons: [
      '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔',
      '❣️','💕','💞','💓','💗','💖','💘','💝','💟',
      '☮️','✝️','☪️','🕉️','☸️','✡️','🔯','🕎','☯️','☦️',
      '🛐','⛎','♈','♉','♊','♋','♌','♍','♎','♏',
      '♐','♑','♒','♓',
      '🔀','🔁','🔂','▶️','⏩','⏭️','⏯️','◀️','⏪','⏮️',
      '🔼','⏫','🔽','⏬','⏸️','⏹️','⏺️','⏏️',
      '🔅','🔆','📶','🛜','📳','📴',
      '♀️','♂️','⚧️',
      '✖️','➕','➖','➗','🟰','♾️',
      '‼️','⁉️','❓','❔','❕','❗',
      '〰️','💱','💲',
      '⚕️','♻️','⚜️','🔱','📛','🔰','⭕','✅','☑️','✔️',
      '❌','❎','➰','➿','〽️','✳️','✴️','❇️',
      '©️','®️','™️',
      '#️⃣','*️⃣','0️⃣','1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣',
      '8️⃣','9️⃣','🔟',
      '🔠','🔡','🔢','🔣','🔤',
      '🅰️','🆎','🅱️','🆑','🆒','🆓','ℹ️','🆔','Ⓜ️','🆕',
      '🆖','🅾️','🆗','🅿️','🆘','🆙','🆚',
      '🈁','🈂️','🈷️','🈶','🈯','🉐','🈹','🈚','🈲','🉑',
      '🈸','🈴','🈳','㊗️','㊙️','🈺','🈵',
      '🔴','🟠','🟡','🟢','🔵','🟣','🟤','⚫','⚪',
      '🟥','🟧','🟨','🟩','🟦','🟪','🟫','⬛','⬜',
      '◼️','◻️','◾','◽','▪️','▫️',
      '🔶','🔷','🔸','🔹','🔺','🔻','💠','🔘','🔳','🔲',
    ],
  },
  bandeiras: {
    label: '🏳️ Bandeiras',
    icons: [
      '🏁','🚩','🎌','🏴','🏳️','🏳️‍🌈','🏳️‍⚧️','🏴‍☠️',
      '🇧🇷','🇺🇸','🇬🇧','🇫🇷','🇩🇪','🇮🇹','🇪🇸','🇵🇹',
      '🇯🇵','🇰🇷','🇨🇳','🇮🇳','🇷🇺','🇦🇺','🇨🇦','🇲🇽',
      '🇦🇷','🇨🇴','🇨🇱','🇵🇪','🇺🇾','🇪🇨','🇧🇴','🇵🇾',
      '🇻🇪','🇨🇺','🇩🇴','🇵🇦','🇨🇷','🇬🇹','🇭🇳','🇸🇻',
    ],
  },
};

// ═══ Picker Component ═══

let activePickerInput = null;
let pickerEl = null;

function createPicker() {
  const picker = document.createElement('div');
  picker.className = 'icon-picker';
  picker.id = 'icon-picker';

  // Header with search
  const header = document.createElement('div');
  header.className = 'ip-header';
  header.innerHTML = `
    <input type="text" class="ip-search" id="ip-search" placeholder="Buscar emoji..." autocomplete="off">
  `;
  picker.appendChild(header);

  // Tabs
  const tabs = document.createElement('div');
  tabs.className = 'ip-tabs';
  const categoryKeys = Object.keys(ICON_CATEGORIES);
  categoryKeys.forEach((key, i) => {
    const cat = ICON_CATEGORIES[key];
    const tab = document.createElement('button');
    tab.className = `ip-tab${i === 0 ? ' active' : ''}`;
    tab.dataset.category = key;
    tab.textContent = cat.label.split(' ')[0]; // Just the emoji
    tab.title = cat.label;
    tab.addEventListener('click', () => switchTab(key));
    tabs.appendChild(tab);
  });
  picker.appendChild(tabs);

  // Grid container
  const grid = document.createElement('div');
  grid.className = 'ip-grid';
  grid.id = 'ip-grid';
  picker.appendChild(grid);

  document.body.appendChild(picker);
  pickerEl = picker;

  // Render first category
  renderGrid(categoryKeys[0]);

  // Search with keyword matching
  document.getElementById('ip-search').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().trim();
    if (q.length === 0) {
      const activeTab = picker.querySelector('.ip-tab.active');
      renderGrid(activeTab?.dataset.category || categoryKeys[0]);
      return;
    }

    // Collect all unique emojis
    const allEmojis = new Set();
    for (const cat of Object.values(ICON_CATEGORIES)) {
      cat.icons.forEach(icon => allEmojis.add(icon));
    }

    // Filter by keyword match
    const results = [];
    for (const emoji of allEmojis) {
      const keywords = EMOJI_KEYWORDS[emoji];
      if (keywords && keywords.toLowerCase().includes(q)) {
        results.push(emoji);
      }
    }

    if (results.length > 0) {
      renderGridDirect(results);
    } else {
      const grid = document.getElementById('ip-grid');
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-muted);font-size:0.85rem">Nenhum resultado para "' + q + '"</div>';
    }
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (!pickerEl) return;
    if (!pickerEl.contains(e.target) && e.target !== activePickerInput) {
      closePicker();
    }
  });

  return picker;
}

function switchTab(category) {
  if (!pickerEl) return;
  pickerEl.querySelectorAll('.ip-tab').forEach(t => t.classList.remove('active'));
  pickerEl.querySelector(`.ip-tab[data-category="${category}"]`)?.classList.add('active');
  document.getElementById('ip-search').value = '';
  renderGrid(category);
}

function renderGrid(category) {
  const cat = ICON_CATEGORIES[category];
  if (!cat) return;
  renderGridDirect(cat.icons);
}

function renderGridDirect(icons) {
  const grid = document.getElementById('ip-grid');
  grid.innerHTML = '';
  for (const icon of icons) {
    const btn = document.createElement('button');
    btn.className = 'ip-icon';
    btn.textContent = icon;
    btn.addEventListener('click', () => selectIcon(icon));
    grid.appendChild(btn);
  }
}

function selectIcon(icon) {
  if (activePickerInput) {
    activePickerInput.value = icon;
    // Trigger input event for reactivity
    activePickerInput.dispatchEvent(new Event('input', { bubbles: true }));
  }
  closePicker();
}

function openPicker(inputEl) {
  if (!pickerEl) createPicker();

  activePickerInput = inputEl;
  const rect = inputEl.getBoundingClientRect();

  // Position below the input
  pickerEl.style.top = (rect.bottom + window.scrollY + 6) + 'px';
  pickerEl.style.left = Math.max(8, rect.left + window.scrollX - 120) + 'px';

  pickerEl.classList.add('visible');

  // Reset to first tab
  switchTab('rotina');
  document.getElementById('ip-search').value = '';

  // Focus search after a tick
  setTimeout(() => document.getElementById('ip-search').focus(), 50);
}

function closePicker() {
  if (pickerEl) pickerEl.classList.remove('visible');
  activePickerInput = null;
}

// ═══ Auto-attach to icon inputs ═══

function attachIconPicker(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.readOnly = true;
  input.style.cursor = 'pointer';
  input.addEventListener('click', (e) => {
    e.stopPropagation();
    if (pickerEl?.classList.contains('visible') && activePickerInput === input) {
      closePicker();
    } else {
      openPicker(input);
    }
  });
}

// Attach on load
document.addEventListener('DOMContentLoaded', () => {
  attachIconPicker('add-icon');
  attachIconPicker('edit-icon');
  attachIconPicker('edit-followup-icon');
});
