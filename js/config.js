/* ============================================================
 * config.js — 发票生成器默认配置 & 字段定义
 * 所有配置最终存入 localStorage，可在线编辑
 * ============================================================ */

// 逻辑字段定义：key 是系统内部标识，cell 是模板中的单元格
const FIELD_SCHEMA = [
  { key: 'recipient',      label: '收件人',        group: '收件信息',  cell: 'B2',  extract: 'recipient' },
  { key: 'address',        label: '详细地址',      group: '收件信息',  cell: 'B3',  extract: 'address'   },
  { key: 'city',           label: '城市',          group: '收件信息',  cell: 'B4',  extract: 'city'      },
  { key: 'province',       label: '省/州',         group: '收件信息',  cell: 'B5',  extract: 'province'  },
  { key: 'postcode',       label: '邮编',          group: '收件信息',  cell: 'B6',  extract: 'postcode'  },
  { key: 'country',        label: '国家/地区',     group: '收件信息',  cell: 'B7',  extract: 'country'   },
  { key: 'phone',          label: '电话',          group: '收件信息',  cell: 'B8',  extract: 'phone'     },
  { key: 'orderNo',        label: '出库单号',      group: '订单信息',  cell: 'D9',  extract: 'orderNo'   },
  { key: 'date',           label: '开票日期',      group: '订单信息',  cell: 'K2',  extract: 'date'      },
  { key: 'platformOrder',  label: '平台单号',      group: '订单信息',  cell: '',    extract: 'platformOrder' },
  { key: 'trackingNo',     label: '跟踪单号',      group: '订单信息',  cell: '',    extract: 'trackingNo' },
];

// 模板标签别名：扫描模板时，用单元格左侧标签匹配成系统字段 key
const FIELD_LABEL_ALIASES = {
  recipient:     ['recipient','recipient s name','recipients name','contact name','name','consignee','customer','收件人','收件人姓名','客户','联系人'],
  company:       ['company name','company','公司名','公司名称'],
  address:       ['address','address 1','street','addr','详细地址','地址'],
  city:          ['city','town','城市','城市名称'],
  province:      ['province state','province/state','province','state','region','省 州','省/州','省'],
  postcode:      ['postcode','postal code','zip','zipcode','邮编','邮政编码'],
  country:       ['country','country region','country/region','国家','国家地区','国家/地区'],
  phone:         ['telephone number','telephone','phone number','phone','tel','mobile','电话','联系电话'],
  email:         ['email','e-mail','邮箱'],
  orderNo:       ['order no','order number','order no.','order','invoice no','invoice number','出库单号','订单号'],
  platformOrder: ['platform order','platform','平台单号','平台订单号'],
  // 跟踪单号/物流单号在 WD 等模板里是独立字段（Tracking Number），不能并进平台单号
  trackingNo:    ['tracking number','tracking no','tracking','waybill no','shipment no','追踪号','跟踪单号','物流单号','运单号'],
  date:          ['date','invoice date','date of exportation','开票日期','出口日期','日期'],
  eori:          ['eori','eori no','收件人税号','税号'],
  originCountry: ['country of origin of goods','country of origin','product origin','产品原产地','原产地'],
  exportCountry: ['country of export','export country','出口国'],
  note:          ['note','备注','备注信息'],
  // 商品明细（表头行）
  product_name:  ['product name','product','commodities','commodity','item','full description of goods','description of goods','货物详情','品名','产品名称'],
  brand_model:   ['brand and model','brand','model','品牌型号','品牌'],
  boxes:         ['boxes pieces ctn','boxes','pieces','ctn','箱数','件数'],
  net_weight:    ['net weight kg','net weight','net wt','净重'],
  gross_weight:  ['gross weight kg','gross weight','gross wt','毛重'],
  pallet:        ['pallet','托盘'],
  unit_price:    ['declared unit price of product','declared unit price','unit price','申报单价','单价'],
  quantity:      ['declared quantity of product','declared quantity','quantity','qty','申报数量','数量'],
  total_amount:  ['total declared amount','declared amount','total amount','total','申报总额','总额'],
  hs_code:       ['product customs code','customs code','hs code','hs','海关编码'],
};

// 商品明细字段定义（第11行）
const ITEM_FIELDS = [
  { key: 'item_no',       label: '序号',        cell: 'A11' },
  { key: 'product_name',  label: '产品名称',    cell: 'B11' },
  { key: 'brand_model',   label: '品牌型号',    cell: 'C11' },
  { key: 'boxes',         label: '箱数/件数',   cell: 'D11' },
  { key: 'net_weight',    label: '净重(KG)',    cell: 'E11' },
  { key: 'gross_weight',  label: '毛重(KG)',    cell: 'F11' },
  { key: 'pallet',        label: '托盘',        cell: 'G11' },
  { key: 'unit_price',    label: '申报单价',    cell: 'H11' },
  { key: 'quantity',      label: '申报数量',    cell: 'I11' },
  { key: 'total_amount',  label: '申报总额',    cell: 'J11' },
  { key: 'hs_code',       label: '海关编码',    cell: 'K11' },
];

// 国家代码 → 国家全称（合成地址时把 GB/CH 等还原成模板里用的全称）
const COUNTRY_DISPLAY_MAP = {
  'GB': 'United Kingdom', 'UK': 'United Kingdom', 'NO': 'Norway', 'CH': 'Switzerland',
  'DE': 'Germany', 'IE': 'Ireland', 'FR': 'France', 'NL': 'Netherlands', 'BE': 'Belgium',
  'AT': 'Austria', 'IT': 'Italy', 'ES': 'Spain', 'SE': 'Sweden', 'DK': 'Denmark',
  'FI': 'Finland', 'PL': 'Poland', 'PT': 'Portugal', 'US': 'United States', 'CA': 'Canada',
  'AU': 'Australia', 'CN': 'China'
};

// 各国邮编正则：用于从一整行地址中识别并拆解邮编
const POSTCODE_PATTERNS = [
  /\b[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}\b/i,  // 英国 BT29 4EF / SW1A 1AA
  /\b\d{4,5}(?:-\d{4})?\b/,                       // 瑞士 9400 / 美国 90210
  /\b\d{3}\s?\d{2}\b/,                            // 挪威 0150
  /\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b/i                // 加拿大
];

// 国家名称 → 国家代码映射（用于 B7 单元格）
const COUNTRY_CODE_MAP = {
  'great britain': 'GB', 'united kingdom': 'GB', 'uk': 'GB', 'england': 'GB', '英国': 'GB',
  'norway': 'NO', '挪威': 'NO',
  'switzerland': 'CH', '瑞士': 'CH',
  'germany': 'DE', '德国': 'DE',
  'ireland': 'IE', '爱尔兰': 'IE',
  'france': 'FR', '法国': 'FR',
  'netherlands': 'NL', '荷兰': 'NL',
  'belgium': 'BE', '比利时': 'BE',
  'austria': 'AT', '奥地利': 'AT',
  'italy': 'IT', '意大利': 'IT',
  'spain': 'ES', '西班牙': 'ES',
  'sweden': 'SE', '瑞典': 'SE',
  'denmark': 'DK', '丹麦': 'DK',
  'finland': 'FI', '芬兰': 'FI',
  'poland': 'PL', '波兰': 'PL',
  'portugal': 'PT', '葡萄牙': 'PT',
  'united states': 'US', 'usa': 'US', '美国': 'US',
  'canada': 'CA', '加拿大': 'CA',
  'australia': 'AU', '澳大利亚': 'AU',
  'china': 'CN', '中国': 'CN',
  // 欧洲国家本地语言写法（OCR 常按截图原文输出）
  'deutschland': 'DE', 'osterreich': 'AT', 'österreich': 'AT', 'schweiz': 'CH', 'suisse': 'CH',
  'espana': 'ES', 'españa': 'ES', 'italia': 'IT', 'nederland': 'NL', 'belgie': 'BE', 'belgië': 'BE',
  'sverige': 'SE', 'norge': 'NO', 'danmark': 'DK', 'suomi': 'FI', 'polska': 'PL', 'irland': 'IE'
};

// OCR 语言增强：按收件国家加载对应的拉丁语系 traineddata，提升带变音符号字符的识别率。
// 仅在 eng 基础上叠加一种语言，避免同时加载多语种导致互相干扰。
const OCR_LANG_BY_COUNTRY = {
  DE: 'deu', AT: 'deu', CH: 'deu',
  FR: 'fra', BE: 'fra',
  ES: 'spa', IT: 'ita', PT: 'por',
  NL: 'nld', PL: 'pol', SE: 'swe', NO: 'nor', DK: 'dan', FI: 'fin',
  IE: 'gle'
};

// OCR 常见“无变音符号转写”纠偏词典：仅在对应国家启用，避免误伤普通英文单词。
const OCR_DIACRITIC_FIXES = {
  DE: { Munchen:'München', Muenchen:'München', Koln:'Köln', Koeln:'Köln', Dusseldorf:'Düsseldorf', Duesseldorf:'Düsseldorf', Strasse:'Straße', Strase:'Straße', Stuttgart:'Stuttgart' },
  AT: { Wien:'Wien', Salzburg:'Salzburg', Graz:'Graz', Innsbruck:'Innsbruck', Strasse:'Straße' },
  CH: { Zurich:'Zürich', Geneve:'Genève', Lausanne:'Lausanne', Bern:'Bern', Basel:'Basel', Strasse:'Straße' },
  FR: { Geneve:'Genève', Nimes:'Nîmes', Andre:'André', Renee:'Renée', Chloe:'Chloé', Cafe:'Café' },
  BE: { Bruxelles:'Bruxelles', Anvers:'Anvers', Liege:'Liège', Andre:'André' },
  ES: { Espana:'España', Malaga:'Málaga', Jose:'José', Andres:'Andrés', Garcia:'García', Munoz:'Muñoz', Lopez:'López' },
  IT: { Milano:'Milano', Roma:'Roma', Napoli:'Napoli', Firenze:'Firenze', Giuseppe:'Giuseppe' },
  PT: { Sao:'São', Joao:'João', Lisboa:'Lisboa', Porto:'Porto' },
  NL: { Amsterdam:'Amsterdam', Rotterdam:'Rotterdam', Maastricht:'Maastricht', Den:'Den' },
  PL: { Krakow:'Kraków', Gdansk:'Gdańsk', Lodz:'Łódź', Wroclaw:'Wrocław', Poznan:'Poznań' },
  SE: { Goteborg:'Göteborg', Malmo:'Malmö', Linkoping:'Linköping', Jonkoping:'Jönköping', Orebro:'Örebro' },
  NO: { Bodo:'Bodø', Alesund:'Ålesund', Tromso:'Tromsø', Kristiansand:'Kristiansand' },
  DK: { Kobenhavn:'København', Aarhus:'Århus', Aalborg:'Ålborg', Odense:'Odense' },
  FI: { Helsinki:'Helsinki', Tampere:'Tampere', Turku:'Turku', Espoo:'Espoo' },
  IE: { Sinead:'Sinéad', Aine:'Áine', Dublin:'Dublin', Cork:'Cork' }
};

// 默认模板配置（3个模板）
const DEFAULT_TEMPLATES = [
  {
    id: 'tpl_uk_kl',
    name: '凯乐仓发票模版',
    fileName: 'templates/#UK2092-KL.xlsx',
    country: 'GB',
    sheetName: '箱单发票',
    cellMap: {
      recipient: 'B2', address: 'B3', city: 'B4', province: 'B5', postcode: 'B6',
      country: 'B7', phone: 'B8', orderNo: 'D9', date: 'K2'
    },
    itemRow: 11,
    itemCellMap: {
      item_no: 'A11', product_name: 'B11', brand_model: 'C11', boxes: 'D11',
      net_weight: 'E11', gross_weight: 'F11', pallet: 'G11', unit_price: 'H11',
      quantity: 'I11', total_amount: 'J11', hs_code: 'K11'
    },
    fixedValues: {
      'E2': 'LYMOW TRADE CO., LIMITED',
      'E3': 'Room 5003, Floor 5, Yau LeeCentre, 45 Hoi Yuen Road,Kwun Tong Kowloon Hong Kong',
      'E4': 'HONG KONG', 'E5': 'HONG KONG', 'E6': '999077', 'E7': 'CHINA', 'E8': '8618511307613',
      'I2': 'KAI-LE International GmbH', 'I3': 'Michael-Felke Straße Halle 6A',
      'I4': 'Hermeskeil', 'I6': '54411', 'I7': 'Germany', 'I8': '0049 1625843969'
    },
    countryOverrides: {
      'GB': { 'H11': 500, 'I11': 1, 'J11': 500 },
      'CH': { 'H11': 900, 'I11': 1, 'J11': 900 },
      'NO': { 'H11': 900, 'I11': 1, 'J11': 900 }
    },
    fileNameRule: '{platformOrder}-KL.xlsx',
    notes: '凯乐仓通用发票模版，已涵盖英国(GB)、瑞士(CH)、挪威(NO)三国，按国家自动匹配申报货值'
  },
  {
    id: 'tpl_wd_non_eu',
    name: 'WD非欧盟出口发票',
    fileName: 'templates/WD-非欧盟出口发票.xlsx',
    country: 'CH',
    sheetName: 'Sheet1',
    cellMap: {
      company:'F5', address:'F8', recipient:'F9', phone:'F11', email:'F15',
      trackingNo:'C16', orderNo:'H2', date:'A3', exportCountry:'A13', note:'A17'
    },
    cellPrefix: {
      company:'Company Name (公司名) :', address:'Completed Address (详细地址) :',
      recipient:'Contact Name (联系人) :', phone:'Phone Number (联系电话) : ',
      email:'Email:  ', orderNo:'Invoice NO. :', date:'DATE OF EXPORTATION (出 口 日期) :',
      exportCountry:'COUNTRY OF EXPORT (出口国) :', note:'备注信息(Note) :'
    },
    composite: { cell:'F8', parts:['address','postcode','city','province','country'], join:', ', countryStyle:'full' },
    fieldDefs: [
      { key:'company', label:'Company Name (公司名)', group:'收件信息', cell:'F5', prefix:'Company Name (公司名) :' },
      { key:'address', label:'详细地址(街道)', group:'收件信息', cell:'', compositePart:true },
      { key:'postcode', label:'邮编', group:'收件信息', cell:'', compositePart:true },
      { key:'city', label:'城市', group:'收件信息', cell:'', compositePart:true },
      { key:'province', label:'省/州', group:'收件信息', cell:'', compositePart:true },
      { key:'country', label:'国家/地区', group:'收件信息', cell:'', compositePart:true },
      { key:'recipient', label:'Contact Name (联系人)', group:'收件信息', cell:'F9', prefix:'Contact Name (联系人) :' },
      { key:'phone', label:'Phone Number (联系电话)', group:'收件信息', cell:'F11', prefix:'Phone Number (联系电话) : ' },
      { key:'email', label:'Email', group:'收件信息', cell:'F15', prefix:'Email:  ' },
      { key:'trackingNo', label:'Tracking Number（跟踪单号）', group:'订单信息', cell:'C16' },
      { key:'platformOrder', label:'平台单号（文件名）', group:'订单信息', cell:'' },
      { key:'orderNo', label:'Invoice NO.', group:'订单信息', cell:'H2', prefix:'Invoice NO. :' },
      { key:'date', label:'出口日期', group:'订单信息', cell:'A3', prefix:'DATE OF EXPORTATION (出 口 日期) :' },
      { key:'exportCountry', label:'出口国', group:'订单信息', cell:'A13', prefix:'COUNTRY OF EXPORT (出口国) :' },
      { key:'note', label:'备注', group:'订单信息', cell:'A17', prefix:'备注信息(Note) :' }
    ],
    itemRow: 19,
    itemCellMap: { item_no:'A19', product_name:'E19', hs_code:'G19', quantity:'H19', unit_price:'I19', total_amount:'J19' },
    fixedValues: {
      'A4':'SHIPPER DETAILS(寄件人详细信息) :',
      'A8':'Room 5003, Floor 5, Yau LeeCentre, 45 Hoi Yuen Road,Kwun Tong Kowloon Hong Kong',
      'A18':'NO.OF\nPKGS\n总数量', 'B18':'PKG TYPE\n包装类型', 'C18':'MATERIAL\n材料',
      'D18':'USE\n用途', 'E18':'FULL DESCRIPTIONOF GOODS\n货物详情', 'G18':'HS CODE\n海关编码',
      'H18':'QUANTITY\n数量', 'I18':'UNIT PRICE\n单价 (EUR/PC)', 'J18':'TOTAL VALUE\n总价 (EUR)',
      'A20':'TOTAL INVOICE VALUE', 'J20':'900'
    },
    countryOverrides: {},
    fileNameRule: '{platformOrder}.xlsx',
    notes: 'WD非欧盟出口发票：标签值同格保留前缀，详细地址由街道/邮编/城市/国家自动合成'
  }
];

// OCR 字段标签词库：不同 OMS 截图的标签叫法不同，统一在这里登记别名。
// 解析方式：把归一化文本按"标签 → 下一个标签之间的文本"切片取值，
// 因此对"标签:值"同行、值和标签分行、一行多组字段都有效。
const OCR_FIELD_LABELS = {
  recipient:     ['收件人姓名','收件人名字','收件人','recipient name','recipients name','consignee','customer name','姓名'],
  company:       ['公司名称','公司名','company name','company'],
  country:       ['收件人国家','国家地区','国家/地区','国家','country','country/region'],
  province:      ['省/州','省 州','省州','province/state','province state','province','state','region'],
  city:          ['城市名称','城市','city','town'],
  postcode:      ['邮编','邮政编码','postcode','postal code','zip','zipcode'],
  address1:      ['地址1','地址 - 1','地址 -1','地址- 1','地址-1','详细地址','地址','address 1','address1','street'],
  address2:      ['地址2','地址 - 2','地址 -2','地址- 2','地址-2','收件人地址2','address 2','address2'],
  phone:         ['联系电话','联系方式','电话','telephone number','telephone','phone number','phone','mobile','tel'],
  email:         ['收件人email','收件人邮箱','邮箱','email address','email','e-mail'],
  orderNo:       ['订单号','出库单号','order no','order number','order','invoice no'],
  platformOrder: ['平台单号','platform order','platform'],
  trackingNo:    ['追踪号(物流单号)','追踪号','跟踪单号','物流单号','运单号','tracking number','tracking no','waybill no'],
  date:          ['出口日期','开票日期','日期','invoice date','date'],
  exportCountry: ['出口国','country of export','export country'],
  originCountry: ['产品原产地','原产地','country of origin'],
  note:          ['订单备注','备注信息','备注','note'],
};

// 结构性标签：截图里的区块标题/其它字段，作为"取值边界"但不输出成发票字段
// 例如 收件人信息、参考号、是否签名 等——遇到它们就停止上一个字段的取值
const OCR_SKIP_LABELS = [
  '订单信息','收件人信息','寄件人信息','商品信息','预报错误信息','取件时间段',
  '参考号','仓库','运输方式','是否签名','购买保险','保价金额','取货时间',
  '取件码','取件时间','订单备注','订单号(物流单号)','收件人税号'
];

// OCR 文本解析规则
const EXTRACT_PATTERNS = {
  orderNo:       [/OBS\s*0?\d{9,}[A-Z]{2}/i, /出库单号[:：]?\s*(\S+)/],
  platformOrder: [/#[A-Z]{2}\d{3,}[A-Z]?/i, /平台单号[:：]?\s*(\S+)/],
  trackingNo:    [/(?:追踪号|物流单号|tracking\s*(?:no|number))[:：]?\s*(\S+)/i],
  recipient:     [/收件人\s+([^\n]+?)(?=\s+收件人税号|\s+电话|\s+邮箱|$)/],
  phone:         [/电话\s*(\+?[\d\s]+?)(?=\s+邮箱|\s+邮编|$)/],
  email:         [/邮箱\s+(\S+@\S+)/],
  postcode:      [/邮编\s+(\S+)/],
  province:      [/省[\/／]州\s+([^\n]+?)(?=\s+城市|\s+地址|$)/],
  city:          [/城市名称\s+([^\n]+?)(?=\s+地址|$)/],
  address1:      [/地址-1\s+([^\n]+?)(?=\s+地址-2|$)/],
  address2:      [/地址-2\s+([^\n]+)/],
  countryRaw:    [/国家[\/／]地区\s+([^\n]+?)(?=\s+门牌号|\s+省|\s+城市|$)/],
  date:          [/(\d{4})[\-\/年](\d{1,2})[\-\/月](\d{1,2})/],
};

// 批量导入：可映射的全部字段（收件信息 + 订单 + 商品明细）
const BATCH_FIELDS = [
  { key: 'recipient',      label: '收件人',        group: '收件信息' },
  { key: 'company',        label: '公司名/收件人公司', group: '收件信息' },
  { key: 'address',        label: '详细地址',      group: '收件信息' },
  { key: 'address1',       label: '地址-1',        group: '收件信息' },
  { key: 'address2',       label: '地址-2',        group: '收件信息' },
  { key: 'city',           label: '城市',          group: '收件信息' },
  { key: 'province',       label: '省/州',         group: '收件信息' },
  { key: 'postcode',       label: '邮编',          group: '收件信息' },
  { key: 'country',        label: '国家/地区',     group: '收件信息' },
  { key: 'phone',          label: '电话',          group: '收件信息' },
  { key: 'email',          label: '邮箱',          group: '收件信息' },
  { key: 'orderNo',        label: '出库单号',      group: '订单信息' },
  { key: 'platformOrder',  label: '平台单号',      group: '订单信息' },
  { key: 'trackingNo',     label: '跟踪单号',      group: '订单信息' },
  { key: 'date',           label: '开票日期',      group: '订单信息' },
  { key: 'product_name',   label: '产品名称',      group: '商品明细' },
  { key: 'brand_model',    label: '品牌型号',      group: '商品明细' },
  { key: 'boxes',          label: '箱数/件数',     group: '商品明细' },
  { key: 'net_weight',     label: '净重(KG)',      group: '商品明细' },
  { key: 'gross_weight',   label: '毛重(KG)',      group: '商品明细' },
  { key: 'pallet',         label: '托盘',          group: '商品明细' },
  { key: 'unit_price',     label: '申报单价',      group: '商品明细' },
  { key: 'quantity',       label: '申报数量',      group: '商品明细' },
  { key: 'total_amount',   label: '申报总额',      group: '商品明细' },
  { key: 'hs_code',        label: '海关编码',      group: '商品明细' },
];

// 列名智能识别别名（小写匹配，命中即自动映射）
const COLUMN_ALIASES = {
  recipient:     ['收件人','收件人姓名','客户','客户名称','姓名','name','recipient','consignee','customer','full name','contact'],
  company:       ['收件人公司','公司名称','公司名','公司','收件人单位','单位名称','company name','company','recipient company','consignee company','business name'],
  address:       ['详细地址','地址','收件地址','完整地址','address','address1','street','addr','full address'],
  address1:      ['地址1','地址-1','地址一','address 1','address line 1','street address'],
  address2:      ['地址2','地址-2','地址二','address 2','address line 2'],
  city:          ['城市','城市名称','city','town'],
  province:      ['省','州','省/州','省份','state','province','region'],
  postcode:      ['邮编','邮政编码','postcode','postal code','zip','zipcode'],
  country:       ['国家','国家/地区','国家地区','国家／地区','country','country code','国家代码'],
  phone:         ['电话','联系电话','联系方式','手机','手机号','phone','tel','mobile','telephone','phone number'],
  email:         ['邮箱','电子邮箱','email','e-mail','mail'],
  orderNo:       ['出库单号','订单号','订单编号','出库单','order no','order number','order id'],
  platformOrder: ['平台单号','平台订单号','平台订单编号','平台订单','platform order','shop order'],
  trackingNo:    ['跟踪单号','跟踪号','追踪号','物流单号','运单号','快递单号','tracking number','tracking no','tracking','waybill','waybill no','shipment no','shipping no'],
  date:          ['日期','开票日期','date','invoice date'],
  product_name:  ['产品名称','品名','商品名称','product','product name','item','commodity'],
  brand_model:   ['品牌型号','品牌','型号','brand','model','brand and model'],
  boxes:         ['箱数','件数','箱数/件数','boxes','pieces','ctn','carton'],
  net_weight:    ['净重','净重(kg)','net weight','net wt'],
  gross_weight:  ['毛重','毛重(kg)','gross weight','gross wt'],
  pallet:        ['托盘','pallet'],
  unit_price:    ['申报单价','单价','declared unit price','unit price','单价(欧元)'],
  quantity:      ['申报数量','数量','declared quantity','quantity','qty'],
  total_amount:  ['申报总额','总额','总金额','declared amount','total','total amount'],
  hs_code:       ['海关编码','hs编码','hs code','customs code','商品编码'],
};

// 生成记录存储 key
const STORAGE_KEYS = {
  TEMPLATES: 'invoice_templates_v2',
  RECORDS: 'invoice_records_v1',
  SETTINGS: 'invoice_settings_v1',
  MAPPINGS: 'invoice_mappings_v1',
};
