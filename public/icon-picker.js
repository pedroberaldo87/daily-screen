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

  // Acessórios pessoais / sair de casa
  '👓': 'óculos oculos glasses vista enxergar leitura',
  '🕶️': 'óculos oculos sol sunglasses escuros',
  '🥽': 'óculos oculos proteção protecao goggles lab segurança seguranca',
  '🪪': 'documento id identidade rg cnh carteira identification',
  '🗝️': 'chave antiga velha key',
  '👛': 'carteira wallet porta moedas purse',
  '💼': 'maleta pasta briefcase trabalho work',
  '👜': 'bolsa handbag feminina',
  '🛍️': 'sacola compras shopping bag',
  '⌚': 'relógio relogio watch pulso hora',
  '🔋': 'bateria battery carregar charge',
  '🔌': 'tomada plug carregador charger energia',
  '🎧': 'fone fones headphone headphones áudio audio música musica',
  '📷': 'câmera camera foto photo',
  '☂️': 'guarda chuva umbrella',
  '🌂': 'guarda chuva fechado umbrella closed',
  '👒': 'chapéu chapeu hat sol',
  '🎩': 'cartola top hat formal',
  '💍': 'anel ring aliança alianca casamento joia',

  // Roupas
  '🧣': 'cachecol scarf inverno frio',
  '🧤': 'luva luvas gloves frio',
  '🧦': 'meia meias socks',
  '👕': 'camiseta tshirt',
  '👖': 'calça calca jeans pants',
  '👗': 'vestido dress',
  '🩳': 'short bermuda shorts',
  '👞': 'sapato shoe masculino',
  '🥾': 'bota boot trilha hike',
  '👠': 'salto heel sapato feminino',

  // Higiene extras
  '🪞': 'espelho mirror',
  '🧻': 'papel higiênico higienico toilet paper',
  '💄': 'batom lipstick maquiagem makeup',
  '💋': 'beijo kiss batom lábios labios',
  '🪮': 'pente comb cabelo',
  '🫧': 'bolhas bubbles sabão sabao',

  // Bebidas extras
  '🧋': 'bubble tea boba chá cha',
  '🍶': 'saquê sake garrafa',
  '🧉': 'mate chimarrão chimarrao tereré terere cuia',
  '🍼': 'mamadeira baby bottle leite bebê bebe',

  // Comida extras
  '🍗': 'frango chicken coxa ave',
  '🍤': 'camarão camarao shrimp',
  '🍱': 'marmita bento lunch box',
  '🍽️': 'prato talheres refeição refeicao dish plate',
  '🥄': 'colher spoon',
  '🍴': 'garfo faca fork knife talheres',
  '🔪': 'faca knife cortar cozinha',

  // Corpo e saúde extras
  '👂': 'orelha ear ouvido audição audicao',
  '🩼': 'muleta crutch',
  '🤒': 'febre termômetro termometro doente sick',
  '🤕': 'machucado injury bandagem',
  '🤧': 'espirro gripe resfriado sneeze cold',
  '😷': 'máscara mascara mask doença doenca',
  '💆': 'massagem massage rosto',
  '💇': 'corte cabelo haircut salão salao',

  // Casa e tarefas
  '🪣': 'balde bucket limpar',
  '🧺': 'cesto roupa suja laundry basket',
  '🗑️': 'lixo trash garbage lixeira',
  '🪠': 'desentupidor plunger',
  '🚪': 'porta door entrada saída saida',
  '🛋️': 'sofá sofa couch',
  '🪑': 'cadeira chair',
  '🪴': 'planta vaso plant pot',
  '🌱': 'muda seedling broto crescer grow',
  '🌿': 'folhas erva herb folhagem',
  '🕯️': 'vela candle',
  '🌷': 'tulipa tulip flor',
  '🌸': 'flor cereja sakura cherry blossom',
  '🌻': 'girassol sunflower',
  '🌹': 'rosa rose flor',
  '🪻': 'jacinto hyacinth lilás lilas flor',
  '🌼': 'margarida daisy flor',
  '🌳': 'árvore arvore tree',
  '🪵': 'tora madeira wood log',
  '🏡': 'casa home jardim garden',

  // Pets
  '🐕': 'cachorro dog cão cao pet passear walk',
  '🐈': 'gato cat pet gatinho',
  '🐾': 'pegadas paws patas pet',
  '🐹': 'hamster pet',
  '🐰': 'coelho rabbit pet',
  '🐠': 'peixe fish aquário aquario pet',

  // Trabalho e produtividade extras
  '🖥️': 'monitor desktop computador screen pc',
  '⌨️': 'teclado keyboard',
  '🖱️': 'mouse',
  '🖨️': 'impressora printer imprimir',
  '☎️': 'telefone fixo landline phone',
  '📲': 'celular mobile chamada phone',
  '💬': 'balão balao mensagem chat conversa',
  '💭': 'pensamento thought ideia bolha',
  '📣': 'megafone megaphone aviso anúncio anuncio',
  '📢': 'alto falante speaker loudspeaker anúncio anuncio',
  '🖊️': 'caneta pen esferográfica esferografica',
  '📒': 'caderno notebook ledger',
  '📔': 'caderno diário diario journal',
  '📕': 'livro book vermelho',
  '📖': 'livro aberto open book leitura ler read',
  '🔖': 'marcador bookmark',
  '🧮': 'ábaco abaco abacus calculadora',
  '📊': 'gráfico grafico barras chart',
  '📈': 'gráfico grafico alta crescimento up',
  '📉': 'gráfico grafico queda down',
  '📏': 'régua regua ruler medir',
  '🗒️': 'bloco notes spiral',
  '🎓': 'formatura graduation escola faculdade',
  '🏢': 'prédio predio escritório escritorio office',
  '🏫': 'escola school colégio colegio',

  // Financeiro
  '💵': 'dolar dólar nota money cash',
  '🪙': 'moeda coin',
  '🧾': 'nota fiscal recibo receipt',
  '💸': 'dinheiro gastar voando fly money spend',
  '💹': 'gráfico grafico yen investimento',
  '🏦': 'banco bank',
  '🏧': 'caixa eletrônico eletronico atm banco',
  '💱': 'câmbio cambio moeda exchange',

  // Compras
  '🏪': 'loja conveniência conveniencia store',
  '🏬': 'loja departamento shopping mall',
  '🚚': 'caminhão caminhao entrega delivery truck',
  '🏷️': 'etiqueta tag preço preco label',

  // Comunicação
  '📨': 'email envelope carta recebida',
  '📤': 'email enviado outbox out',
  '📥': 'email inbox recebido in',

  // Transporte
  '🚕': 'táxi taxi uber amarelo',
  '🚌': 'ônibus onibus bus',
  '🚐': 'van minibus',
  '🏍️': 'moto motorcycle motocicleta',
  '🛵': 'moto scooter lambreta',
  '🚲': 'bicicleta bike bicycle pedal',
  '🛴': 'patinete kick scooter',
  '🚑': 'ambulância ambulancia ambulance emergência emergencia',
  '✈️': 'avião aviao airplane voo',
  '🚆': 'trem train',
  '🚢': 'navio ship barco',
  '⛽': 'gasolina combustível combustivel fuel posto',
  '🅿️': 'estacionamento parking park',

  // Clima extras
  '🌤️': 'sol nuvem parcial partly sunny',
  '⛅': 'parcialmente nublado partly cloudy',
  '🌦️': 'sol e chuva sun rain',
  '🌨️': 'nevando neve snow',
  '☃️': 'boneco neve snowman',
  '⛄': 'boneco neve snowman',
  '💨': 'vento wind dash ar',
  '🌫️': 'névoa nevoa neblina fog',
  '☔': 'guarda chuva umbrella chuva rain',
  '🌞': 'sol sorriso sun smile',
  '🌝': 'lua cheia sorriso moon smile',

  // Humor e emoções
  '😀': 'feliz happy sorriso smile grande',
  '😊': 'sorriso feliz corado blush',
  '🙂': 'sorriso leve slight smile',
  '😌': 'aliviado relieved calmo',
  '😔': 'pensativo triste pensive sad',
  '😢': 'chorar cry lágrima lagrima triste',
  '😡': 'bravo raiva angry furioso',
  '🥺': 'suplicante pleading carente',
  '🤯': 'explodindo mind blown choque',
  '💔': 'coração coracao partido broken heart',
  '🙏': 'mãos maos juntas pray rezar obrigado gratidão gratidao thanks',
  '💫': 'tontura dizzy estrela estonteado',

  // Hobbies e lazer
  '🎨': 'paleta arte pintura art',
  '🎬': 'claquete filme movie cinema',
  '🎸': 'guitarra guitar violão violao',
  '🎹': 'piano teclado keyboard',
  '🥁': 'bateria drum',
  '🎵': 'nota música musica music',
  '🎶': 'música musica notas notes',
  '🧩': 'quebra cabeça cabeca puzzle',
  '🎲': 'dado dice jogo',
  '🎮': 'controle video game gamepad',
  '🎯': 'alvo dardo target meta foco focus',
  '📺': 'televisão televisao tv',
  '📻': 'rádio radio',
  '♟️': 'xadrez chess peão peao',
  '🎤': 'microfone microphone karaoke cantar',

  // Família
  '👪': 'família familia family',
  '👫': 'casal couple',
  '👶': 'bebê bebe baby',
  '👴': 'idoso vovô vovo grandpa',
  '👵': 'idosa vovó vovo grandma',
  '🎉': 'festa party comemoração comemoracao',
  '🎂': 'bolo cake aniversário aniversario',
  '🎁': 'presente gift',
  '🎈': 'balão balao balloon festa',
  '💝': 'presente coração coracao gift heart',

  // Checklist
  '☑️': 'check box marcado checkbox',
  '✔️': 'check certo correto',
  '⚠️': 'aviso warning atenção atencao alerta',
  '💯': 'cem 100 perfeito pontos',
  '🏆': 'troféu trofeu trophy vencedor premio prêmio',
  '🔕': 'sino mudo mute silencioso',
  '⏰': 'alarme alarm despertador hora time',
  '💥': 'explosão explosao boom impacto',
};

const ICON_CATEGORIES = {
  rotina: {
    labelKey: 'icon.category.routine',
    icons: [
      // Saúde e corpo
      '💊','💉','🩺','🩹','🩼','🩻','🧬','🧪','🔬','🫀','🫁','🧠','🦷','🦴','👁️','👂','🩸','🤒','🤕','🤧','😷','🌡️','💆','💇',
      // Acessórios e sair de casa
      '👓','🕶️','🥽','🪪','🔑','🗝️','👛','💼','🎒','👜','🛍️','💳','💰','📱','⌚','⏰','🔋','🔌','🎧','📷','☂️','🌂','🧢','👒','🎩','💍',
      // Roupas
      '🧥','🧣','🧤','🧦','👔','👕','👖','👗','🩳','👟','👞','🥾','👠',
      // Higiene
      '🪥','🧴','🧼','🪒','💈','🚿','🛁','🪞','🧽','🧻','💄','💋','🪮','🫧',
      // Hidratação
      '💧','🥛','🧃','☕','🍵','🧋','🍶','🥤','🍼','🧊','🫗','🧉',
      // Alimentação
      '🍎','🍊','🍋','🍌','🍇','🍓','🫐','🥝','🥭','🍍','🥑','🥦','🥕','🌽','🍅','🧅','🧄','🫚','🍠','🥜','🫘','🌰','🥚','🍳','🥣','🥗','🍚','🍞','🥐','🧀','🥩','🍗','🐟','🍤','🍱','🍽️','🥄','🍴','🔪','🧂',
      // Exercício e movimento
      '💪','🏃','🚶','🧘','🧗','🏋️','🚴','🚵','🤸','🏊','⚽','🎾','🥊','🛹','⛷️','🏂','🤿','🏄',
      // Sono
      '😴','🛌','🛏️','💤','🌙','🌛','⭐','✨',
      // Casa e tarefas
      '🏠','🏡','🧹','🪣','🧺','🗑️','🪠','🚪','🛋️','🪑','🪴','🌱','🌿','💐','🌷','🌸','🌻','🌹','🪻','🌼','🌳','🪵','🕯️',
      // Pets
      '🐕','🐶','🐈','🐱','🐦','🐹','🐰','🐠','🐾',
      // Trabalho e produtividade
      '💻','🖥️','⌨️','🖱️','🖨️','☎️','📧','✉️','💬','🔔','📝','✏️','🖊️','📒','📔','📕','📖','📚','🔖','📋','📌','📍','📎','📏','🧮','📊','📈','📉','🗒️','🗓️','📅','📆','🔍','💡','🎓','🏢','🏫',
      // Financeiro
      '💵','🪙','🧾','💸','💹','🏦','🏧','💱',
      // Compras
      '🛒','🏪','🏬','📦','🚚','🏷️',
      // Comunicação
      '📞','📲','📨','📤','📥','💭','📣','📢',
      // Transporte
      '🚗','🚕','🚌','🚐','🏍️','🛵','🚲','🛴','🚑','✈️','🚆','🚢','⛽','🅿️',
      // Clima
      '☀️','🌤️','⛅','☁️','🌧️','⛈️','🌨️','❄️','☃️','💨','🌪️','🌫️','🌈','☔','🌞','🌝',
      // Humor e mente
      '😀','😊','🙂','😌','😔','😢','😡','🥺','🤯','❤️','💔','🙏','💫','🔥','⚡',
      // Hobbies e lazer
      '🎨','🎬','🎸','🎹','🥁','🎵','🎶','🧩','🎲','🎮','🎯','📺','📻','♟️','🎤',
      // Família e social
      '👪','👫','👶','👴','👵','🎉','🎂','🎁','🎈','💝',
      // Checklist e lembretes
      '✅','☑️','✔️','❌','⭕','⛔','🚫','⚠️','❗','❓','‼️','💯','🔴','🟠','🟡','🟢','🔵','♻️','🔕','🏁','🚩','🏆','💥',
    ],
  },
  rostos: {
    labelKey: 'icon.category.faces',
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
    labelKey: 'icon.category.nature',
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
    labelKey: 'icon.category.food',
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
    labelKey: 'icon.category.objects',
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
    labelKey: 'icon.category.symbols',
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
  atividades: {
    labelKey: 'icon.category.activities',
    icons: [
      '⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱',
      '🪀','🏓','🏸','🏒','🏑','🥍','🏏','🪃','🥅','⛳',
      '🪁','🏹','🎣','🤿','🥊','🥋','🎽','🛹','🛼','🛷',
      '⛸️','🥌','🎿','⛷️','🏂','🪂','🏋️','🤼','🤸','⛹️',
      '🤺','🤾','🏌️','🏇','🧘','🏄','🏊','🤽','🚣','🧗',
      '🚵','🚴','🏆','🥇','🥈','🥉','🏅','🎖️','🏵️','🎗️',
      '🎫','🎟️','🎪','🤹','🎭','🩰','🎨','🎬','🎤','🎧',
      '🎼','🎹','🥁','🪘','🎷','🎺','🎸','🪕','🎻','🪗',
      '🎲','♟️','🎯','🎳','🎮','🕹️','🎰','🧩','🪅','🪆',
      '🖼️','🧵','🪡','🧶','🪢',
    ],
  },
  viagens: {
    labelKey: 'icon.category.travel',
    icons: [
      '🚗','🚕','🚙','🚌','🚎','🏎️','🚓','🚑','🚒','🚐',
      '🛻','🚚','🚛','🚜','🦯','🦽','🦼','🛴','🚲','🛵',
      '🏍️','🛺','🚨','🚔','🚍','🚘','🚖','🚡','🚠','🚟',
      '🚃','🚋','🚞','🚝','🚄','🚅','🚈','🚂','🚆','🚇',
      '🚊','🚉','✈️','🛫','🛬','🛩️','💺','🛰️','🚀','🛸',
      '🚁','🛶','⛵','🚤','🛥️','🛳️','⛴️','🚢','⚓','🪝',
      '⛽','🚧','🚦','🚥','🗺️','🗿','🗽','🗼','🏰','🏯',
      '🏟️','🎡','🎢','🎠','⛲','⛱️','🏖️','🏝️','🏜️','🌋',
      '⛰️','🏔️','🗻','🏕️','⛺','🛖','🏠','🏡','🏘️','🏚️',
      '🏗️','🏭','🏢','🏬','🏣','🏤','🏥','🏦','🏨','🏪',
      '🏫','🏩','💒','🏛️','⛪','🕌','🛕','🕍','⛩️','🕋',
      '🌁','🌃','🏙️','🌄','🌅','🌆','🌇','🌉','🎑',
      '🗾','🌐','🌍','🌎','🌏','🧭',
    ],
  },
  bandeiras: {
    labelKey: 'icon.category.flags',
    icons: [
      '🏁','🚩','🎌','🏴','🏳️','🏳️‍🌈','🏳️‍⚧️','🏴‍☠️',
      // Américas
      '🇧🇷','🇺🇸','🇨🇦','🇲🇽','🇦🇷','🇨🇴','🇨🇱','🇵🇪',
      '🇺🇾','🇪🇨','🇧🇴','🇵🇾','🇻🇪','🇨🇺','🇩🇴','🇵🇦',
      '🇨🇷','🇬🇹','🇭🇳','🇸🇻','🇳🇮','🇯🇲','🇭🇹','🇹🇹',
      '🇧🇸','🇧🇧','🇵🇷','🇬🇾','🇸🇷','🇧🇿',
      // Europa
      '🇬🇧','🇫🇷','🇩🇪','🇮🇹','🇪🇸','🇵🇹','🇳🇱','🇧🇪',
      '🇨🇭','🇦🇹','🇮🇪','🇩🇰','🇸🇪','🇳🇴','🇫🇮','🇮🇸',
      '🇵🇱','🇨🇿','🇸🇰','🇭🇺','🇷🇴','🇧🇬','🇬🇷','🇷🇸',
      '🇭🇷','🇸🇮','🇧🇦','🇲🇰','🇦🇱','🇲🇪','🇽🇰','🇪🇪',
      '🇱🇻','🇱🇹','🇧🇾','🇺🇦','🇲🇩','🇱🇺','🇲🇹','🇨🇾',
      '🇻🇦','🇲🇨','🇦🇩','🇸🇲','🇱🇮','🇪🇺',
      // Ásia
      '🇷🇺','🇯🇵','🇰🇷','🇰🇵','🇨🇳','🇹🇼','🇭🇰','🇲🇴',
      '🇮🇳','🇵🇰','🇧🇩','🇱🇰','🇳🇵','🇧🇹','🇲🇻','🇦🇫',
      '🇮🇷','🇮🇶','🇸🇦','🇦🇪','🇶🇦','🇧🇭','🇰🇼','🇴🇲',
      '🇾🇪','🇯🇴','🇱🇧','🇸🇾','🇮🇱','🇵🇸','🇹🇷','🇦🇲',
      '🇬🇪','🇦🇿','🇰🇿','🇺🇿','🇹🇯','🇰🇬','🇹🇲','🇲🇳',
      '🇹🇭','🇻🇳','🇱🇦','🇰🇭','🇲🇲','🇲🇾','🇸🇬','🇮🇩',
      '🇵🇭','🇧🇳','🇹🇱',
      // África
      '🇪🇬','🇿🇦','🇳🇬','🇰🇪','🇪🇹','🇬🇭','🇲🇦','🇩🇿',
      '🇹🇳','🇱🇾','🇸🇩','🇸🇸','🇸🇳','🇨🇮','🇨🇲','🇺🇬',
      '🇹🇿','🇿🇼','🇿🇲','🇲🇿','🇦🇴','🇳🇦','🇧🇼','🇲🇬',
      '🇲🇺','🇷🇼','🇧🇮','🇨🇩','🇨🇬','🇬🇦','🇬🇶','🇨🇫',
      '🇹🇩','🇳🇪','🇲🇱','🇧🇫','🇲🇷','🇬🇲','🇬🇼','🇬🇳',
      '🇸🇱','🇱🇷','🇹🇬','🇧🇯','🇪🇷','🇩🇯','🇸🇴','🇰🇲',
      '🇸🇨','🇸🇹','🇨🇻','🇱🇸','🇸🇿','🇲🇼',
      // Oceania
      '🇦🇺','🇳🇿','🇫🇯','🇵🇬','🇼🇸','🇹🇴','🇻🇺','🇸🇧',
      '🇵🇫','🇳🇨','🇰🇮','🇲🇭','🇫🇲','🇵🇼','🇳🇷','🇹🇻',
      // Organizações
      '🇺🇳',
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
    <input type="text" class="ip-search" id="ip-search" placeholder="Buscar emoji..." data-i18n-placeholder="icon.search" autocomplete="off">
  `;
  picker.appendChild(header);

  // Tabs
  const tabs = document.createElement('div');
  tabs.className = 'ip-tabs';
  const categoryKeys = Object.keys(ICON_CATEGORIES);
  categoryKeys.forEach((key, i) => {
    const cat = ICON_CATEGORIES[key];
    const label = typeof t === 'function' ? t(cat.labelKey) : cat.labelKey;
    const tab = document.createElement('button');
    tab.className = `ip-tab${i === 0 ? ' active' : ''}`;
    tab.dataset.category = key;
    tab.textContent = label.split(' ')[0]; // Just the emoji
    tab.title = label;
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
      const noResultsMsg = typeof t === 'function' ? t('icon.noResults', { query: q }) : `Nenhum resultado para "${q}"`;
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-muted);font-size:0.85rem">' + escapeHtml(noResultsMsg) + '</div>';
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
