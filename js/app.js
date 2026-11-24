/* ============================================================
 * app.js — 发票生成器主逻辑
 * ============================================================ */

const state = {
  templates: [],
  records: [],
  settings: {},
  currentTemplateId: null,
  recognizedFields: {},
  view: 'generate',
};

/* ---------- 本地存储 ---------- */
function loadState() {
  try {
    const t = localStorage.getItem(STORAGE_KEYS.TEMPLATES);
    state.templates = t ? JSON.parse(t) : JSON.parse(JSON.stringify(DEFAULT_TEMPLATES));
  } catch(e) { state.templates = JSON.parse(JSON.stringify(DEFAULT_TEMPLATES)); }
  // 内置模板自动补齐：老用户 localStorage 里没有新增的内置模板时补进去，
  // 但不动用户已有的同名模板（按 id 判断，已存在则保留用户的自定义配置）
  try {
    let added = false;
    DEFAULT_TEMPLATES.forEach(def => {
      if (!state.templates.some(x => x.id === def.id)) {
        state.templates.push(JSON.parse(JSON.stringify(def))); added = true;
      }
    });
    if (added) saveTemplates();
  } catch(e) { /* 补齐失败不影响主流程 */ }
  // 兼容迁移：旧版 WD 模板把 Tracking Number(C16) 归到 platformOrder。
  // 现在跟踪单号是独立字段，迁移后批量表同时有"平台单号"和"跟踪单号"也不会写错格。
  try {
    let migrated = false;
    state.templates.forEach(t => {
      if (t.id !== 'tpl_wd_non_eu') return;
      t.cellMap = t.cellMap || {};
      if (t.cellMap.platformOrder === 'C16' && !t.cellMap.trackingNo) {
        delete t.cellMap.platformOrder;
        t.cellMap.trackingNo = 'C16';
        migrated = true;
      }
      if (Array.isArray(t.fieldDefs)) {
        t.fieldDefs.forEach(f => {
          if (f.key === 'platformOrder' && f.cell === 'C16') {
            f.key = 'trackingNo';
            f.label = 'Tracking Number（跟踪单号）';
            migrated = true;
          }
        });
      }
    });
    if (migrated) saveTemplates();
  } catch(e) { /* 迁移失败不影响主流程 */ }
  try {
    const r = localStorage.getItem(STORAGE_KEYS.RECORDS);
    state.records = r ? JSON.parse(r) : [];
  } catch(e) { state.records = []; }
  try {
    const s = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    state.settings = s ? JSON.parse(s) : { autoDate: true, phoneStripPlus: true };
  } catch(e) { state.settings = { autoDate: true, phoneStripPlus: true }; }
}
function saveTemplates() { localStorage.setItem(STORAGE_KEYS.TEMPLATES, JSON.stringify(state.templates)); }
function saveRecords()   { localStorage.setItem(STORAGE_KEYS.RECORDS, JSON.stringify(state.records)); }
function saveSettings()  { localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(state.settings)); }

/* ---------- 工具函数 ---------- */
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function getTemplate(id) { return state.templates.find(t => t.id === id); }
function currentGenTemplate() {
  const sel = document.getElementById('genTemplate');
  return sel ? getTemplate(sel.value) : null;
}
function countryToCode(raw) {
  if (!raw) return '';
  let s = raw.toLowerCase().trim();
  // "Great Britain (United Kingdom)" → 取括号内外分别匹配
  let keys = Object.keys(COUNTRY_CODE_MAP);
  for (let k of keys) { if (s.includes(k)) return COUNTRY_CODE_MAP[k]; }
  return raw.trim();
}
function stripPhone(v) {
  if (!v) return '';
  return v.replace(/[+\s\-()]/g, '');
}
function cleanOrderNo(v) {
  if (!v) return '';
  return v.replace(/^Order\s*No\.*\s*[:：]?\s*/i, '').trim();
}
// 邮编清洗：去掉 OCR 带进来的前导符号（——、-、:、~ 等），
// 只保留符合目标国家邮编格式的部分；不符合则丢弃噪声只留数字/字母段。
function cleanPostcode(v, countryCode) {
  if (!v) return '';
  let s = String(v).trim();
  // 去掉开头/结尾的非字母数字字符（如 "——1872"、"- 1872"、"~:1872"）
  s = s.replace(/^[^\w\u4e00-\u9fa5]+/,'').replace(/[^\w]+$/,'').trim();
  // 该国邮编正则：只取符合格式的一段
  const byCountry = {
    CH: /^\d{4}$/, NO: /^\d{4}$/, DE: /^\d{5}$/, AT: /^\d{4}$/,
    FR: /^\d{5}$/, IT: /^\d{5}$/, ES: /^\d{5}$/, BE: /^\d{4}$/,
    DK: /^\d{4}$/, SE: /^\d{3}\s?\d{2}$/, FI: /^\d{5}$/, PL: /^\d{2}-?\d{3}$/,
    US: /^\d{5}(-\d{4})?$/, CA: /^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/i, AU: /^\d{4}$/,
    CN: /^\d{6}$/, GB: /^[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}$/i
  };
  const re = byCountry[countryCode];
  if (re) {
    // 先整体匹配，再尝试从串里抽出符合格式的子段
    if (re.test(s)) return s;
    const m = s.match(new RegExp(re.source.replace(/^\^|(\$)$/g,''), 'i'));
    return m ? m[0].trim() : s.replace(/[^\dA-Za-z]/g,'');
  }
  return s;
}
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function toast(msg, type='info') {
  const box = document.getElementById('toastBox');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => { el.classList.add('toast-out'); setTimeout(()=>el.remove(), 300); }, 3000);
}

/* ---------- 文本解析（对 OCR 噪声鲁棒） ---------- */
// OCR 常把中文逐字拆开（"收 件 人"），先把相邻中文之间的空格去掉；
// 同时把全角符号归一化为半角，方便后续匹配。
function normalizeOcrText(text) {
  return text.replace(/\r/g,'')
    .replace(/[（]/g,'(').replace(/[）]/g,')')
    .replace(/[：]/g,':').replace(/[，]/g,',')
    .replace(/[＃]/g,'#')  // 全角 # → 半角
    .replace(/[－—–]/g,'-')
    // 两个中文字符之间的空格去掉
    .replace(/([\u4e00-\u9fa5])\s+(?=[\u4e00-\u9fa5])/g,'$1')
    // 中文与斜杠之间的空格也去掉（"国 礼 / 坛 区" → "国礼/坛区"）
    .replace(/([\u4e00-\u9fa5])\s+([\/])/g,'$1$2')
    .replace(/([\/])\s+([\u4e00-\u9fa5])/g,'$1$2')
    // 中文与数字/字母之间的空格：保留（它们是标签与值的分隔，如 "地址 2" "Email phillip"）
    ;
}

function parseOrderText(text) {
  const out = {};
  const norm = normalizeOcrText(text);
  const lines = norm.split('\n').map(s=>s.trim()).filter(Boolean);
  const full = lines.join(' ');

  // 标签字符容错：OCR 可能把"地区"识别成"坛区"、"收件人"识别成"收 件 人"（已在归一化处理）
  function findLineValue(labelRegex, nextLine) {
    for (let i=0;i<lines.length;i++){
      const m = lines[i].match(labelRegex);
      if (m) {
        if (m[1] && m[1].trim()) return m[1].trim();
        // 标签后无值（OCR 把值和标签拆成两行）→ 尝试取下一行
        if (nextLine && i+1 < lines.length) {
          const nxt = lines[i+1].trim();
          if (nxt && !/[\u4e00-\u9fa5]/.test(nxt)) return nxt; // 下一行不含中文，视为值
        }
      }
    }
    return '';
  }

  // --- 主解析：按"标签 → 下一个标签之间的文本"切片取值 ---
  // 兼容两种布局：① 标签与值同一行且一行多组（WD 等 OMS）② 标签和值分行（凯乐仓）
  function parseByLabels() {
    // 收集所有标签（含结构边界标签）的出现位置
    const hits = [];
    const addLabels = (key, labels, skip) => labels.forEach(label => {
      const re = new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'gi');
      let m;
      while ((m = re.exec(full)) !== null) {
        hits.push({ key, start:m.index, end:m.index+m[0].length, len:m[0].length, skip:!!skip });
        re.lastIndex = m.index + m[0].length;
      }
    });
    Object.entries(OCR_FIELD_LABELS).forEach(([key, labels]) => addLabels(key, labels, false));
    addLabels('__skip__', OCR_SKIP_LABELS, true);
    // 同一起点取最长标签（"收件人姓名"优先于"收件人"，"地址2"优先于"地址"）
    hits.sort((a,b)=> a.start-b.start || b.len-a.len);
    // 重叠时保留先出现的最长标签
    const picked = [];
    hits.forEach(h => {
      if (picked.some(p => h.start < p.end)) return;
      picked.push(h);
    });
    picked.forEach((h, i) => {
      if (h.skip) return; // 结构边界只用于截断，不输出
      const nextStart = i+1 < picked.length ? picked[i+1].start : full.length;
      let v = full.slice(h.end, nextStart).trim();
      v = v.replace(/^[\s:：=＝"'"'、，,]+/,'').trim();       // 去掉标签后的冒号/引号
      v = v.replace(/^[\s"“]+/,'').trim();                    // 去掉中文引号
      v = v.replace(/\s{2,}/g,' ').trim();
      if (!v || v==='-' || v==='N/A') return;
      if (/[\u4e00-\u9fa5]{3,}/.test(v)) return;              // 值里出现长中文说明，视为非值
      // 单号类字段必须是"含字母或数字"的实值，排除 "(" 这类残缺标点
      if (['orderNo','platformOrder','trackingNo','postcode','phone'].includes(h.key) && !/[A-Za-z0-9]/.test(v)) return;
      if (!out[h.key]) out[h.key] = v;                        // 同一字段取首个有效值
    });
  }
  parseByLabels();

  // --- 结构化标签字段（旧版精确正则，作为补充/兜底） ---
  out.orderNo = out.orderNo || (full.match(/OBS\s*0?\d{9,}[A-Z]{2}/i)||[])[0] || findLineValue(/OBS\s*(\d{9,}[A-Z]{2})/i);
  // 平台单号：优先标签解析；否则用特征（#UK2092 / LT#2227 / 纯数字追踪号）
  const platFeature = full.match(/[A-Z]\s*[A-Z]?\s*#\s*\d{3,}[A-Z]?|#\s*[A-Z]{2}\s*\d{3,}[A-Z]?/i);
  if (!out.platformOrder) {
    const trackVal = findLineValue(/追踪号[^\s]*\s*\(?\s*物?流?单?号?\)?[:：]?\s*(\d{6,})/);
    // 兜底：整段文本里"物流单号/追踪号"后面的长数字串
    const trackFeature = full.match(/(?:物流单号|追踪号)[^0-9]{0,12}(\d{8,})/);
    out.platformOrder = (platFeature ? platFeature[0].replace(/\s+/g,'') : '')
      || trackVal || (trackFeature ? trackFeature[1] : '')
      || findLineValue(/平台单号[:：]?\s*(\S+)/, true);
  }
  // 跟踪单号与平台单号互为兜底：截图里只出现其中一种叫法时，两个字段都能有值
  if (!out.trackingNo && out.platformOrder) out.trackingNo = out.platformOrder;
  if (!out.platformOrder && out.trackingNo) out.platformOrder = out.trackingNo;
  // 邮箱尾部噪声：OCR 有时把别的字段值(如 DEPT)并到邮箱末尾。
  // 这些不是地址内容，直接从邮箱里剥掉并丢弃，绝不写入 address2。
  if (out.email) {
    const em = out.email.match(/^(.+?@\S+?)\s+([A-Za-z][A-Za-z0-9 .#\-]{1,20})$/);
    if (em) out.email = em[1];
  }
  out.recipient = out.recipient || findLineValue(/收\s*件\s*人\s*(?:姓\s*名)?\s+([A-Za-z][^\s].*?)(?=\s+收件人|\s+电话|\s+邮箱|$)/i);
  out.postcode = out.postcode || findLineValue(/邮\s*[编邹]\s+(\S+)/);
  if (!out.postcode) {
    const pc = full.match(/\b[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}\b/)
      || full.match(/(?<![#A-Za-z0-9])\b\d{4,5}\b(?![\d#])/); // 排除 LT#2227 这类单号里的数字
    if (pc) out.postcode = pc[0].trim();
  }
  out.province = out.province || findLineValue(/省\s*[\/]\s*州\s+(.+?)(?=\s+区\/县|\s+城市|\s+地址|$)/);
  out.city = out.city || findLineValue(/城\s*市\s*(?:名\s*称)?\s+(.+?)(?=\s+地址|\s+国家|$)/);
  // 地址：标签解析已分别拿到 address1/address2；否则用旧正则
  const cleanPart = v => (v && v !== '-' && v !== 'N/A' && v.trim()) ? v.trim() : '';
  let a1 = out.address1 || findLineValue(/地\s*址\s*-?\s*1?\s+(.+?)(?=\s+地址|$)/);
  let a2 = out.address2 || findLineValue(/地\s*址\s*-?\s*2\s+(.+)$/);
  out.address = [cleanPart(a1), cleanPart(a2)].filter(Boolean).join('\n');
  out.countryRaw = out.country || out.countryRaw || findLineValue(/国[\s家礼][\s\/]*[地坛]区\s+(.+?)(?=\s+门牌号|\s+省|\s+城市|$)/);

  // --- 特征兜底：标签识别错乱时，用数据本身的特征抓取 ---
  if (!out.email) {
    const em = full.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    if (em) out.email = em[0];
  }
  if (!out.phone) {
    const ph = full.match(/\+\d[\d\s-]{6,}/);
    if (ph) out.phone = ph[0];
  }
  if (!out.countryRaw) {
    for (const key of Object.keys(COUNTRY_CODE_MAP)) {
      const re = new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i');
      const m = full.match(re);
      if (m) { out.countryRaw = m[0]; break; }
    }
  }
  out.country = countryToCode(out.countryRaw);

  // 归一化清洗
  if (out.province) {
    if (state.settings.provinceStripParens !== false) out.province = out.province.replace(/\s*\([^)]*\)/g,'');
    out.province = out.province.replace(/\s*\/\s*县.*$/,'').trim();
  }
  if (out.city) out.city = out.city.replace(/\s*\([^)]*\)/g,'').trim();
  // 邮编按国家格式清洗，去掉 OCR 带入的符号（如 ——1872 → 1872）
  if (out.postcode) out.postcode = cleanPostcode(out.postcode, out.country);
  if (state.settings.phoneStripPlus) out.phone = stripPhone(out.phone);
  out.orderNo = cleanOrderNo(out.orderNo);
  out.date = todayStr();

  // 过滤掉 "-" "N/A" 占位及明显噪声
  Object.keys(out).forEach(k => {
    if (out[k]==='-' || out[k]==='N/A' || (typeof out[k]==='string' && out[k].length<2)) out[k]='';
  });
  return out;
}

/* ---------- OCR 识别 ---------- */
// 图像预处理：2x 放大 + 灰度 + 对比度拉伸，显著提升 Tesseract 对小字截图的识别率
async function preprocessImage(file) {
  const img = await createImageBitmap(file);
  const scale = 2;
  const cv = document.createElement('canvas');
  cv.width = img.width * scale; cv.height = img.height * scale;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, cv.width, cv.height);
  const data = ctx.getImageData(0, 0, cv.width, cv.height);
  const d = data.data;
  for (let i=0;i<d.length;i+=4) {
    // 温和灰度化，保留明暗层次（激进二值化会让浅色文字和红框一起丢失）
    const g = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
    d[i]=d[i+1]=d[i+2]=g;
  }
  ctx.putImageData(data, 0, 0);
  return new Promise(res => cv.toBlob(res, 'image/png'));
}

async function recognizeScreenshot(file) {
  const statusEl = document.getElementById('ocrStatus');
  statusEl.style.display = 'block';
  statusEl.textContent = '正在预处理截图…';
  try {
    if (!window.Tesseract) throw new Error('OCR 引擎未加载');
    const processed = await preprocessImage(file);
    statusEl.textContent = '正在识别截图文字（中英双语，首次需加载语言包，请稍候）…';
    // 截图是中文界面+英文值，必须用 chi_sim+eng 双语；语言包指向本地目录，离线可用
    const result = await Tesseract.recognize(processed, 'chi_sim+eng', {
      langPath: 'vendor/tessdata',
      logger: m => {
        if (m.status === 'recognizing text') statusEl.textContent = `识别中… ${Math.round(m.progress*100)}%`;
        else if (m.status === 'loading language traineddata') statusEl.textContent = '正在加载中文语言包…';
      }
    });
    const text = result.data.text || '';
    statusEl.textContent = '识别完成，请在下方核对字段';
    setTimeout(()=>statusEl.style.display='none', 2000);
    return { text, fields: parseOrderText(text) };
  } catch(e) {
    statusEl.textContent = '识别失败：' + e.message + ' —— 请改用"粘贴文本"方式';
    toast('OCR 识别失败，请改用"粘贴文本"方式', 'error');
    return { text:'', fields:{} };
  }
}

/* ---------- 表单渲染 ---------- */
// 获取模板的字段定义：优先用模板自定义的 fieldDefs，否则从 FIELD_SCHEMA 派生（兼容旧模板）
function getFieldDefs(template) {
  if (template && Array.isArray(template.fieldDefs) && template.fieldDefs.length) return template.fieldDefs;
  return FIELD_SCHEMA.map(f => ({ key:f.key, label:f.label, group:f.group, cell:f.cell||'' }));
}
function renderFieldForm(fields, containerId, template) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const defs = getFieldDefs(template);
  const groups = {};
  defs.forEach(f => {
    if (!groups[f.group]) groups[f.group] = [];
    groups[f.group].push(f);
  });
  // 识别状态汇总：列出未识别到的字段，提醒手动补填
  const missing = defs.filter(f => f.key!=='date' && !(fields[f.key]||'').trim());
  let html = '';
  if (missing.length) {
    html += `<div class="ocr-warn">⚠ 有 ${missing.length} 个字段未自动识别，请对照截图手动补填：${missing.map(f=>escapeHtml(f.label)).join('、')}</div>`;
  } else {
    html += `<div class="ocr-ok">✓ 所有字段均已识别，请核对无误后生成</div>`;
  }
  for (const [g, fs] of Object.entries(groups)) {
    html += `<div class="form-group-title">${escapeHtml(g)}</div><div class="form-grid">`;
    fs.forEach(f => {
      const val = fields[f.key] !== undefined ? fields[f.key] : '';
      const isMulti = f.key === 'address';
      const status = val && String(val).trim() ? 'field-recognized' : 'field-missing';
      html += `<label class="form-field ${status}"><span>${escapeHtml(f.label)}${val && String(val).trim() ? ' <b class="fcheck">✓</b>' : ' <i class="fneed">需填写</i>'}</span>
        ${isMulti
          ? `<textarea data-field="${f.key}" rows="2" placeholder="留空则不修改">${escapeHtml(val)}</textarea>`
          : `<input type="text" data-field="${f.key}" value="${escapeHtml(val)}" placeholder="留空则不修改" ${f.key==='date'?'data-date="1"':''}></label>`}
        </label>`;
    });
    html += `</div>`;
  }
  container.innerHTML = html;
}
function collectFields(containerId) {
  const container = document.getElementById(containerId);
  const out = {};
  container.querySelectorAll('[data-field]').forEach(i => { out[i.dataset.field] = i.value.trim(); });
  return out;
}

/* ---------- 模板选择渲染 ---------- */
function renderTemplateSelect(selectId, onChangeCb) {
  const sel = document.getElementById(selectId);
  sel.innerHTML = state.templates.map(t =>
    `<option value="${t.id}">${escapeHtml(t.name)} · ${escapeHtml(t.country)}</option>`
  ).join('');
  if (state.currentTemplateId && getTemplate(state.currentTemplateId)) sel.value = state.currentTemplateId;
  if (onChangeCb) sel.onchange = e => { state.currentTemplateId = e.target.value; onChangeCb(e.target.value); };
}

/* ---------- 核心：生成 Excel ---------- */
async function generateInvoiceExcel(template, fields, itemDefaults, fileName) {
  // 文件名含 # 等特殊字符时必须逐段编码，否则 # 会被当作 URL 锚点截断
  // 注意 uploaded: 是本地协议前缀，冒号不能编码，否则会绕过 fetch 覆盖导致 404
  const rawName = template.fileName;
  const url = rawName.startsWith('uploaded:')
    ? 'uploaded:' + encodeURIComponent(rawName.slice(9))
    : rawName.split('/').map(encodeURIComponent).join('/');
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('无法加载模板文件：' + template.fileName + '（HTTP ' + resp.status + '）');
  const buf = await resp.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.getWorksheet(template.sheetName) || wb.worksheets[0];

  // 【跟踪单号兼容】不同 OMS 对同一个单号有不同叫法：Tracking Number / 追踪号 / 平台单号。
  // 任一字段有值都能写进模板对应的单元格（WD 模板 C16）；显式填空字符串时不兜底，尊重用户清空。
  fields = Object.assign({}, fields);
  if (fields.trackingNo === undefined && fields.platformOrder !== undefined) fields.trackingNo = fields.platformOrder;
  if (fields.platformOrder === undefined && fields.trackingNo !== undefined) fields.platformOrder = fields.trackingNo;

  // 填充收件人/订单字段
  // 关键：识别结果里明确为空的字段（如省州为空）必须清空模板单元格，
  // 否则会残留模板里的旧值（如 Northern Ireland）；但字段完全未提供（undefined）时保留模板原值。
  // 合成地址字段：把多个组成部分拼成一个单元格（只拼有值的部分，按 join 连接）
  const comp = template.composite;
  const compParts = comp ? comp.parts : [];
  if (comp) {
    const vals = [];
    compParts.forEach(k => {
      let v = fields[k];
      if (v === undefined || v === null || String(v).trim()==='') return;
      v = String(v).replace(/\s*\n\s*/g, ', ').trim();
      if (k === 'country') {
        const code = (COUNTRY_CODE_MAP[String(v).toLowerCase()] || String(v).toUpperCase());
        v = comp.countryStyle === 'full' ? (COUNTRY_DISPLAY_MAP[code] || v) : code;
      }
      vals.push(v);
    });
    ws.getCell(comp.cell).value = vals.length ? vals.join(comp.join || ', ') : null;
  }

  Object.entries(template.cellMap || {}).forEach(([key, cell]) => {
    if (!cell) return;
    // 合成地址的组成字段由上面的 composite 统一写入，这里跳过避免覆盖
    if (comp && comp.cell === cell) return;
    let v = fields[key];
    if (v === undefined) return;  // 字段未提供 → 保留模板原值
    // 标签值同格：写入时保留前缀（如 "Name (姓名) :"），只替换后面的值
    const prefix = (template.cellPrefix || {})[key] || '';
    if (v === null || v === '') {
      // 字段明确为空 → 清空值部分；有前缀则保留前缀，否则清空整格（保留样式）
      ws.getCell(cell).value = prefix || null;
      return;
    }
    // 日期特殊处理（有前缀时按字符串拼接，避免整格变成日期丢前缀）
    if (key === 'date') {
      const d = new Date(v);
      if (!isNaN(d.getTime())) {
        if (prefix) { ws.getCell(cell).value = prefix + d.toISOString().slice(0,10); return; }
        ws.getCell(cell).value = d; ws.getCell(cell).numFmt = 'yyyy-mm-dd'; return;
      }
    }
    // 订单号：无前缀且模板原格式为 "Order No.:xxx" 时补回前缀（语义识别的模板已有自己的前缀）
    if (key === 'orderNo' && !prefix && !/^Order\s*No\./i.test(v)) v = 'Order No.:' + v;
    ws.getCell(cell).value = prefix + v;
  });

  // 固定内容（模板本身已有，这里用于覆盖修正）
  Object.entries(template.fixedValues || {}).forEach(([cell, v]) => {
    if (v !== '' && v != null) ws.getCell(cell).value = v;
  });

  // 国家覆盖值（申报货值等）
  const countryCode = (fields.country || template.country || '').toUpperCase();
  const overrides = (template.countryOverrides || {})[countryCode] || {};
  Object.entries(overrides).forEach(([cell, v]) => {
    const userItemField = Object.entries(template.itemCellMap || {}).find(([k,c])=>c===cell);
    // 如果用户在上一步填了值，不覆盖用户值（除非是默认值）
    ws.getCell(cell).value = v;
  });

  // 商品明细：用户填的值覆盖
  Object.entries(itemDefaults || {}).forEach(([key, v]) => {
    const cell = (template.itemCellMap || {})[key];
    if (cell && v !== '' && v != null) ws.getCell(cell).value = v;
  });

  // 文件名
  let finalName = fileName;
  if (!finalName) {
    const platform = fields.platformOrder || fields.trackingNo || fields.orderNo || 'invoice';
    finalName = (template.fileNameRule || '{platformOrder}.xlsx')
      .replace('{platformOrder}', platform)
      .replace('{trackingNo}', fields.trackingNo || platform)
      .replace('{orderNo}', fields.orderNo||'');
  }
  if (!/\.xlsx?$/i.test(finalName)) finalName += '.xlsx';
  finalName = finalName.replace(/[\\/:*?"<>|]/g, '_');

  const outBuf = await wb.xlsx.writeBuffer();
  return { buffer: outBuf, fileName: finalName };
}

function downloadBlob(buffer, fileName) {
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fileName; document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ---------- 视图切换 ---------- */
function switchView(view) {
  state.view = view;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view===view));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id==='view-'+view));
  // 进入生成/批量页时刷新模板下拉，确保同步模板管理里的改名/新增/删除
  if (view==='generate') renderTemplateSelect('genTemplate');
  if (view==='batch') renderTemplateSelect('batchTemplate');
  if (view==='templates') renderTemplateList();
  if (view==='history') renderHistory();
  if (view==='settings') renderSettings();
}

/* ---------- 模板管理 ---------- */
function renderTemplateList() {
  const box = document.getElementById('templateList');
  box.innerHTML = state.templates.map(t => `
    <div class="tpl-card">
      <div class="tpl-card-head">
        <div><strong>${escapeHtml(t.name)}</strong> <span class="badge">${escapeHtml(t.country)}</span></div>
        <div class="tpl-actions">
          <button class="btn btn-sm" onclick="openTplEditor('${t.id}')">编辑</button>
          <button class="btn btn-sm btn-danger" onclick="deleteTemplate('${t.id}')">删除</button>
        </div>
      </div>
      <div class="tpl-card-body">
        <div>文件：${escapeHtml(t.fileName)}</div>
        <div>字段映射：${Object.keys(t.cellMap||{}).length} 项 · 固定内容：${Object.keys(t.fixedValues||{}).length} 项 · 国家覆盖：${Object.keys(t.countryOverrides||{}).length} 组</div>
        ${t.notes?`<div class="tpl-note">${escapeHtml(t.notes)}</div>`:''}
      </div>
    </div>
  `).join('');
}

function openTplEditor(id) {
  const t = getTemplate(id);
  if (!t) return;
  document.getElementById('tplEditorTitle').textContent = '编辑模板：' + t.name;
  document.getElementById('tplEditId').value = t.id;
  document.getElementById('tplName').value = t.name;
  document.getElementById('tplCountry').value = t.country;
  document.getElementById('tplSheet').value = t.sheetName;
  document.getElementById('tplFileRule').value = t.fileNameRule || '';
  document.getElementById('tplNotes').value = t.notes || '';

  // 字段映射表（可增删、可改字段名）
  const defs = getFieldDefs(t);
  let mapHtml = '<table class="edit-table"><thead><tr><th style="width:30%">字段名称</th><th>单元格</th><th>保留前缀</th><th style="width:60px">操作</th></tr></thead><tbody id="fieldRows">';
  defs.forEach(f => {
    mapHtml += mapFieldRowHtml(f.key, f.label, (t.cellMap||{})[f.key]||'', f.group, f.prefix || (t.cellPrefix||{})[f.key] || '');
  });
  mapHtml += '</tbody></table><button type="button" class="btn btn-sm" style="margin-top:10px" onclick="addMapFieldRow()">+ 添加字段</button>';
  mapHtml += '<p class="hint">字段名称显示在"核对字段"表单上；单元格填对应位置（如 B2）；"保留前缀"用于"标签:值"同格（如填 Name : 生成时保留标签只换值）。新增字段需在核对表单手动填值。</p>';
  document.getElementById('tplCellMap').innerHTML = mapHtml;

  // 固定内容表
  let fixHtml = '<table class="edit-table"><thead><tr><th>单元格</th><th>内容</th><th></th></tr></thead><tbody id="fixedRows">';
  Object.entries(t.fixedValues||{}).forEach(([cell,v]) => {
    fixHtml += fixedRowHtml(cell,v);
  });
  fixHtml += '</tbody></table><button class="btn btn-sm" onclick="addFixedRow()">+ 添加固定内容</button>';
  document.getElementById('tplFixedValues').innerHTML = fixHtml;

  // 国家覆盖
  let ovHtml = '';
  Object.entries(t.countryOverrides||{}).forEach(([c,vals]) => {
    ovHtml += `<div class="ov-group"><div class="ov-head">国家代码：<input type="text" class="ov-country" value="${escapeHtml(c)}" placeholder="如 GB"><button class="btn btn-sm btn-danger" onclick="this.parentElement.parentElement.remove()">删除组</button></div>
      <div class="ov-values">${Object.entries(vals).map(([cell,v])=>`<span class="ov-item">${escapeHtml(cell)}:<input type="text" class="ov-cell" data-cell="${escapeHtml(cell)}" value="${escapeHtml(v)}"></span>`).join('')}</div>
      <button class="btn btn-sm" onclick="addOvItem(this)">+ 添加单元格</button></div>`;
  });
  document.getElementById('tplOverrides').innerHTML = ovHtml;

  document.getElementById('tplEditor').style.display = 'flex';
}
function fixedRowHtml(cell,v) {
  return `<tr><td><input type="text" class="fx-cell" value="${escapeHtml(cell)}" style="width:70px"></td><td><input type="text" class="fx-val" value="${escapeHtml(v)}"></td><td><button class="btn btn-sm btn-danger" onclick="this.closest('tr').remove()">×</button></td></tr>`;
}
function addFixedRow() {
  document.getElementById('fixedRows').insertAdjacentHTML('beforeend', fixedRowHtml('',''));
}
// 字段映射行：字段名称可编辑、单元格可编辑、可删除
function mapFieldRowHtml(key, label, cell, group, prefix) {
  return `<tr class="map-row">
    <td><input type="hidden" class="map-key" value="${escapeHtml(key)}"><input type="hidden" class="map-group" value="${escapeHtml(group||'自定义字段')}"><input type="text" class="map-label" value="${escapeHtml(label)}" placeholder="字段名称"></td>
    <td><input type="text" class="map-cell" value="${escapeHtml(cell)}" placeholder="如 B2" style="width:90px"></td>
    <td><input type="text" class="map-prefix" value="${escapeHtml(prefix||'')}" placeholder="保留前缀" style="width:130px"></td>
    <td><button type="button" class="btn btn-sm btn-danger" onclick="this.closest('tr').remove()">×</button></td>
  </tr>`;
}
function addMapFieldRow() {
  const key = 'custom_' + Date.now();
  document.getElementById('fieldRows').insertAdjacentHTML('beforeend', mapFieldRowHtml(key, '', ''));
  // 聚焦到新行的字段名称输入框
  const rows = document.querySelectorAll('#fieldRows tr');
  rows[rows.length-1].querySelector('.map-label').focus();
}
function addOvItem(btn) {
  const cell = prompt('输入单元格地址（如 H11）：');
  if (!cell) return;
  btn.insertAdjacentHTML('beforebegin', `<span class="ov-item">${escapeHtml(cell)}:<input type="text" class="ov-cell" data-cell="${escapeHtml(cell)}" value=""></span>`);
}
function closeTplEditor() { document.getElementById('tplEditor').style.display='none'; }
function saveTplEditor() {
  const id = document.getElementById('tplEditId').value;
  const t = getTemplate(id);
  if (!t) return;
  t.name = document.getElementById('tplName').value.trim() || t.name;
  t.country = document.getElementById('tplCountry').value.trim().toUpperCase();
  t.sheetName = document.getElementById('tplSheet').value.trim() || t.sheetName;
  t.fileNameRule = document.getElementById('tplFileRule').value.trim();
  t.notes = document.getElementById('tplNotes').value.trim();

  // 字段映射：从动态行重建 fieldDefs + cellMap + cellPrefix
  t.fieldDefs = [];
  t.cellMap = {};
  t.cellPrefix = {};
  document.querySelectorAll('#fieldRows tr').forEach(tr => {
    const key = tr.querySelector('.map-key').value.trim();
    const label = tr.querySelector('.map-label').value.trim();
    const cell = tr.querySelector('.map-cell').value.trim().toUpperCase();
    const group = tr.querySelector('.map-group') ? tr.querySelector('.map-group').value : '自定义字段';
    const prefixEl = tr.querySelector('.map-prefix');
    const prefix = prefixEl ? prefixEl.value : '';
    if (!key) return;
    t.fieldDefs.push({ key, label: label || key, group: group || '自定义字段', cell, prefix: prefix || undefined });
    if (cell) t.cellMap[key] = cell;
    if (prefix) t.cellPrefix[key] = prefix;
  });

  t.fixedValues = {};
  document.querySelectorAll('#fixedRows tr').forEach(tr => {
    const c = tr.querySelector('.fx-cell').value.trim().toUpperCase();
    const v = tr.querySelector('.fx-val').value;
    if (c) t.fixedValues[c]=v;
  });

  t.countryOverrides = {};
  document.querySelectorAll('.ov-group').forEach(g => {
    const c = g.querySelector('.ov-country').value.trim().toUpperCase();
    if (!c) return;
    const vals = {};
    g.querySelectorAll('.ov-cell').forEach(i => { if(i.value.trim()!=='') vals[i.dataset.cell]=i.value.trim(); });
    t.countryOverrides[c]=vals;
  });

  saveTemplates(); closeTplEditor(); renderTemplateList();
  // 立即刷新两处模板下拉，避免生成页仍显示旧名称
  renderTemplateSelect('genTemplate');
  renderTemplateSelect('batchTemplate');
  toast('模板配置已保存','success');
}
function deleteTemplate(id) {
  const t = getTemplate(id);
  if (!confirm(`确定删除模板「${t.name}」？`)) return;
  state.templates = state.templates.filter(x=>x.id!==id);
  saveTemplates(); renderTemplateList(); toast('已删除','success');
}
function addNewTemplate() {
  const id = 'tpl_' + Date.now();
  const t = { id, name:'新模板', fileName:'', country:'', sheetName:'Sheet1', cellMap:{}, itemRow:11, itemCellMap:{}, fixedValues:{}, countryOverrides:{}, fileNameRule:'{platformOrder}.xlsx', notes:'新建模板，请上传文件并配置映射' };
  state.templates.push(t); saveTemplates(); renderTemplateList(); openTplEditor(id);
  toast('新模板已创建，请填写配置并上传模板文件','info');
}

/* ---------- 历史记录 ---------- */
function renderHistory() {
  const box = document.getElementById('historyList');
  // 容量信息（localStorage 以 UTF-16 存储，通常约 5~10MB 上限）
  const bytes = new Blob([JSON.stringify(state.records)]).size;
  const kb = (bytes/1024).toFixed(1);
  const info = document.getElementById('storageInfo');
  info.textContent = `共 ${state.records.length} 条记录 · 占用约 ${kb} KB（浏览器上限通常 5MB，超出会无法保存）`;
  if (!state.records.length) { box.innerHTML='<p class="empty">暂无生成记录</p>'; return; }
  box.innerHTML = `<table class="data-table"><thead><tr><th>时间</th><th>收件人</th><th>平台单号</th><th>跟踪单号</th><th>模板</th><th>文件名</th><th>操作</th></tr></thead><tbody>` +
    state.records.slice().reverse().map((r,i)=>`
      <tr><td>${escapeHtml(r.time)}</td><td>${escapeHtml(r.recipient||'')}</td><td>${escapeHtml(r.platformOrder||'')}</td><td>${escapeHtml(r.trackingNo||'')}</td><td>${escapeHtml(r.templateName||'')}</td><td>${escapeHtml(r.fileName||'')}</td>
      <td><button class="btn btn-sm" onclick="viewRecord(${state.records.length-1-i})">查看</button>
          <button class="btn btn-sm btn-danger" onclick="deleteRecord(${state.records.length-1-i})">删除</button></td></tr>`).join('') + '</tbody></table>';
}
function viewRecord(idx) {
  const r = state.records[idx];
  alert('记录详情：\n' + JSON.stringify(r.fields, null, 2));
}
function deleteRecord(idx) {
  if (!confirm('确定删除这条记录？')) return;
  state.records.splice(idx,1);
  saveRecords(); renderHistory(); toast('记录已删除','success');
}
function clearOldRecords() {
  const cutoff = Date.now() - 30*24*60*60*1000;
  const before = state.records.length;
  state.records = state.records.filter(r => {
    // 新记录用 ts 时间戳；旧记录没有 ts 则保留（避免误删）
    return r.ts ? r.ts >= cutoff : true;
  });
  const removed = before - state.records.length;
  saveRecords(); renderHistory();
  toast(removed ? `已清理 ${removed} 条旧记录` : '没有 30 天前的记录', 'success');
}
function clearAllRecords() {
  if (!confirm(`确定清空全部 ${state.records.length} 条生成记录？此操作不可撤销。`)) return;
  state.records = [];
  saveRecords(); renderHistory(); toast('已清空全部记录','success');
}

/* ---------- 设置 ---------- */
// 内置偏好定义（key / 标签 / 类型 / 默认值）
const BUILTIN_SETTINGS = [
  { key:'autoDate',            label:'自动填写开票日期为当天',        type:'bool', def:true },
  { key:'phoneStripPlus',      label:'电话号码自动去除 + 号和空格',  type:'bool', def:true },
  { key:'provinceStripParens', label:'省/州去除括号缩写 (NIR)',      type:'bool', def:true },
  { key:'defaultFileNameRule', label:'默认文件名规则',              type:'text', def:'{platformOrder}.xlsx', placeholder:'{platformOrder}.xlsx' },
];

function renderSettings() {
  // 内置偏好
  const box = document.getElementById('builtinSettings');
  box.innerHTML = BUILTIN_SETTINGS.map(s => {
    const val = state.settings[s.key] !== undefined ? state.settings[s.key] : s.def;
    if (s.type==='bool') {
      return `<label class="checkbox-line"><input type="checkbox" data-bsetting="${s.key}" ${val?'checked':''}> ${escapeHtml(s.label)}</label>`;
    }
    return `<label class="form-field" style="margin:8px 0"><span>${escapeHtml(s.label)}</span>
      <input type="text" data-bsetting="${s.key}" value="${escapeHtml(val)}" placeholder="${escapeHtml(s.placeholder||'')}"></label>`;
  }).join('');
  // 自定义偏好
  renderCustomSettings();
}
function saveSettingsFromUI() {
  document.querySelectorAll('[data-bsetting]').forEach(el=>{
    state.settings[el.dataset.bsetting] = el.type==='checkbox' ? el.checked : el.value.trim();
  });
  // 同步自定义项到 settings 对象（key 输入框与 val 输入框按行配对）
  const newCustom = {};
  document.querySelectorAll('.custom-setting-row').forEach(row=>{
    const k = row.querySelector('.ckey').value.trim();
    const v = row.querySelector('.cval').value.trim();
    if (k) newCustom[k] = v;
  });
  state.settings.custom = newCustom;
  saveSettings(); toast('设置已保存','success');
}

function renderCustomSettings() {
  const box = document.getElementById('customSettings');
  const custom = state.settings.custom || {};
  const keys = Object.keys(custom);
  if (!keys.length) { box.innerHTML = '<p class="empty" style="padding:16px">暂无自定义设置项</p>'; return; }
  box.innerHTML = keys.map((k,i)=>`
    <div class="custom-setting-row">
      <input type="text" class="ckey" data-csetting-key="${escapeHtml(k)}" value="${escapeHtml(k)}" placeholder="名称">
      <input type="text" class="cval" data-csetting-val="${i}" value="${escapeHtml(custom[k])}" placeholder="值">
      <button class="btn btn-sm btn-danger" onclick="deleteCustomSetting(this)">删除</button>
    </div>`).join('');
}
function addCustomSetting() {
  const key = prompt('新设置项名称（如：默认申报货值）：');
  if (!key || !key.trim()) return;
  state.settings.custom = state.settings.custom || {};
  if (state.settings.custom[key.trim()] !== undefined) { toast('该名称已存在','error'); return; }
  state.settings.custom[key.trim()] = '';
  saveSettings(); renderCustomSettings(); toast('已新增，请填写值后保存','success');
}
function deleteCustomSetting(btn) {
  const row = btn.closest('.custom-setting-row');
  const key = row.querySelector('.ckey').value.trim();
  if (!confirm(`确定删除设置项「${key}」？`)) return;
  delete state.settings.custom[key];
  saveSettings(); renderCustomSettings(); toast('已删除','success');
}

/* ---------- 单笔生成流程 ---------- */
async function onScreenshotUpload(input) {
  const file = input.files[0]; if(!file) return;
  const res = await recognizeScreenshot(file);
  document.getElementById('rawText').value = res.text;
  renderFieldForm(res.fields, 'fieldForm', currentGenTemplate());
  document.getElementById('stepPreview').style.display='block';
  if (Object.values(res.fields).some(v=>v)) toast('识别完成，请核对下方字段','success');
}
function onPasteParse() {
  const text = document.getElementById('rawText').value;
  if (!text.trim()) { toast('请先粘贴订单文本','error'); return; }
  const fields = parseOrderText(text);
  renderFieldForm(fields, 'fieldForm', currentGenTemplate());
  document.getElementById('stepPreview').style.display='block';
  toast('解析完成，请核对下方字段','success');
}
function manualFill() {
  renderFieldForm({}, 'fieldForm', currentGenTemplate());
  document.getElementById('stepPreview').style.display='block';
}
async function doGenerate() {
  const fields = collectFields('fieldForm');
  // 日期兜底：任何模式下留空都自动填当天，避免清空模板日期
  if (!fields.date && state.settings.autoDate !== false) fields.date = todayStr();
  const tplId = document.getElementById('genTemplate').value;
  const t = getTemplate(tplId);
  if (!t) { toast('请选择模板','error'); return; }
  if (!t.fileName) { toast('该模板未关联文件，请先在模板管理中上传','error'); return; }
  try {
    const { buffer, fileName } = await generateInvoiceExcel(t, fields, {}, document.getElementById('genFileName').value.trim());
    downloadBlob(buffer, fileName);
    // 记录
    state.records.push({ time:new Date().toLocaleString('zh-CN'), ts:Date.now(), templateId:t.id, templateName:t.name, fields, fileName, recipient:fields.recipient, platformOrder:fields.platformOrder, trackingNo:fields.trackingNo });
    saveRecords();
    toast(`已生成：${fileName}`,'success');
    document.getElementById('genResult').innerHTML = `<div class="result-ok">✅ 生成成功：<strong>${escapeHtml(fileName)}</strong><br><span>文件已开始下载，请在浏览器下载目录查看。</span></div>`;
  } catch(e) {
    toast('生成失败：'+e.message,'error');
    document.getElementById('genResult').innerHTML = `<div class="result-err">❌ 生成失败：${escapeHtml(e.message)}</div>`;
  }
}

/* ---------- 批量生成（全灵活导入） ---------- */
let batchWb = null;          // 当前上传的工作簿
let batchRows = [];          // 解析后的数据行
let batchHeaders = [];       // 当前表头

function loadMappings() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.MAPPINGS) || '[]'); }
  catch(e) { return []; }
}
function saveMappings(list) { localStorage.setItem(STORAGE_KEYS.MAPPINGS, JSON.stringify(list)); }

// 智能列名匹配：返回 {字段key: 列名}
function smartDetectMapping(headers) {
  const result = {};
  const norm = h => String(h||'').toLowerCase().replace(/[\s_\-()（）\/／.]/g,'');
  BATCH_FIELDS.forEach(f => {
    const aliases = COLUMN_ALIASES[f.key] || [];
    for (const alias of aliases) {
      const na = norm(alias);
      const hit = headers.find(h => norm(h) === na || norm(h).includes(na) || na.includes(norm(h)));
      if (hit) { result[f.key] = hit; break; }
    }
  });
  return result;
}

// 旧版 .xls（OLE2/BIFF8）ExcelJS 读不了，用 SheetJS 读出来后转成 ExcelJS 工作簿
function copySheetJsWorkbook(srcWb, targetWb) {
  if (!srcWb || !srcWb.SheetNames || !srcWb.SheetNames.length) throw new Error('文件里没有可读取的工作表');
  srcWb.SheetNames.forEach(name => {
    const rows = XLSX.utils.sheet_to_json(srcWb.Sheets[name], { header:1, raw:true, defval:'', blankrows:true });
    const safeName = String(name).replace(/[\\/?*\[\]:]/g,'_').slice(0,31) || 'Sheet1';
    const ws = targetWb.addWorksheet(safeName);
    rows.forEach((r,ri)=>r.forEach((v,ci)=>{
      if (v===null || v===undefined || v==='') return;
      if (v instanceof Date) v = v.toISOString().slice(0,10);
      ws.getCell(ri+1,ci+1).value = v;
    }));
  });
}
function importLegacyXls(buf, targetWb) {
  if (typeof XLSX === 'undefined') throw new Error('缺少旧版 Excel(.xls) 解析组件，请强制刷新页面后重试');
  copySheetJsWorkbook(XLSX.read(new Uint8Array(buf), { type:'array', cellDates:true }), targetWb);
}

async function onBatchExcelUpload(input) {
  const file = input.files[0]; if(!file) return;
  try {
    const buf = await file.arrayBuffer();
    const h = new Uint8Array(buf.slice(0,4));
    const isOle = h[0]===0xD0 && h[1]===0xCF && h[2]===0x11 && h[3]===0xE0;  // 真 .xls
    batchWb = new ExcelJS.Workbook();
    if (isOle) {
      importLegacyXls(buf, batchWb);
    } else {
      try { await batchWb.xlsx.load(buf); }
      catch(e) {
        // 有些 ERP 导出的 .xls 其实是 HTML 表格或 CSV 文本
        const text = new TextDecoder('utf-8').decode(buf);
        if (/\.csv$/i.test(file.name)) {
          batchWb = new ExcelJS.Workbook();
          await loadCsvIntoWorkbook(batchWb, buf);
        } else if (/^\s*(?:<(!doctype|html|table)|div|meta)/i.test(text) && typeof XLSX !== 'undefined') {
          batchWb = new ExcelJS.Workbook();
          copySheetJsWorkbook(XLSX.read(text, { type:'string' }), batchWb);
        } else if (typeof XLSX !== 'undefined') {
          batchWb = new ExcelJS.Workbook();
          importLegacyXls(buf, batchWb);
        } else throw e;
      }
    }
    if (!batchWb.worksheets.length) throw new Error('文件里没有可读取的工作表，请确认文件内容');
    const sheetSel = document.getElementById('batchSheet');
    sheetSel.innerHTML = batchWb.worksheets.map((ws,i)=>`<option value="${i}">${escapeHtml(ws.name)}</option>`).join('');
    document.getElementById('batchInfo').style.display='block';
    document.getElementById('batchInfo').textContent = `已读取「${file.name}」，共 ${batchWb.worksheets.length} 个工作表。请确认工作表与表头行。`;
    document.getElementById('batchStep2').style.display='block';
    document.getElementById('batchStep3').style.display='none';
    document.getElementById('batchStep4').style.display='none';
    refreshBatchData();
  } catch(e){
    // 读取失败时清掉上一次的残留数据，避免"失败提示 + 旧表格"并存造成误解
    batchWb = null; batchRows = []; batchHeaders = [];
    ['batchStep2','batchStep3','batchStep4'].forEach(id=>{ document.getElementById(id).style.display='none'; });
    toast('读取失败：'+e.message,'error');
  }
}

// CSV 简易解析（支持引号包裹）
async function loadCsvIntoWorkbook(wb, buf) {
  const text = new TextDecoder('utf-8').decode(buf);
  const rows = [];
  let cur=[], field='', inQ=false;
  for (let i=0;i<text.length;i++){
    const ch=text[i];
    if (inQ) {
      if (ch==='"') { if (text[i+1]==='"'){field+='"';i++;} else inQ=false; }
      else field+=ch;
    } else {
      if (ch==='"') inQ=true;
      else if (ch===',') { cur.push(field); field=''; }
      else if (ch==='\n') { cur.push(field); rows.push(cur); cur=[]; field=''; }
      else if (ch==='\r') { /* skip */ }
      else field+=ch;
    }
  }
  if (field||cur.length){ cur.push(field); rows.push(cur); }
  const ws = wb.addWorksheet('CSV');
  rows.forEach((r,ri)=>r.forEach((v,ci)=>ws.getCell(ri+1,ci+1).value=v));
}

// 根据当前工作表/表头行重新读取数据
function refreshBatchData() {
  if (!batchWb) return;
  const idx = parseInt(document.getElementById('batchSheet').value||'0',10);
  const headerRow = Math.max(1, parseInt(document.getElementById('batchHeaderRow').value||'1',10));
  const ws = batchWb.worksheets[idx] || batchWb.worksheets[0];
  if (!ws) return;
  // 收集表头（合并表头的单元格值）
  const headerMap = {};
  ws.getRow(headerRow).eachCell((c,col)=>{
    const v = c.value;
    if (v!==null && v!==undefined && String(v).trim()) headerMap[col] = String(v).trim();
  });
  batchHeaders = Object.values(headerMap);
  // 读取数据行
  batchRows = [];
  ws.eachRow((row,rowNumber)=>{
    if (rowNumber<=headerRow) return;
    const obj = {};
    Object.entries(headerMap).forEach(([col,h])=>{ obj[h] = row.getCell(Number(col)).value; });
    if (Object.values(obj).some(v=>v!==null&&v!==undefined&&String(v).trim()!=='')) batchRows.push(obj);
  });
  document.getElementById('batchInfo').textContent = `工作表「${ws.name}」· 表头第 ${headerRow} 行 · 共 ${batchRows.length} 行数据 · ${batchHeaders.length} 列`;
  // 智能匹配 + 渲染
  const detected = smartDetectMapping(batchHeaders);
  renderBatchMapping(batchHeaders, detected);
  renderBatchPreview();
  refreshSavedMappingSelect();
  document.getElementById('batchStep3').style.display='block';
  document.getElementById('batchStep4').style.display='block';
}

function renderBatchMapping(headers, detected) {
  const box = document.getElementById('batchMapping');
  // 合并全局字段 + 当前模板的自定义字段（custom_ 前缀或不在全局列表里的）
  const fields = [...BATCH_FIELDS];
  const tplSel = document.getElementById('batchTemplate');
  const tpl = tplSel ? getTemplate(tplSel.value) : null;
  if (tpl) {
    const known = new Set(BATCH_FIELDS.map(f=>f.key));
    (tpl.fieldDefs||[]).forEach(f=>{
      if (!known.has(f.key)) { fields.push({ key:f.key, label:f.label, group:'模板自定义字段' }); known.add(f.key); }
    });
  }
  let html = '';
  let lastGroup = '';
  fields.forEach(f => {
    if (f.group!==lastGroup) {
      if (lastGroup) html += '</div>';
      html += `<div class="form-group-title">${escapeHtml(f.group)}</div><div class="form-grid">`;
      lastGroup = f.group;
    }
    const matched = detected[f.key] || '';
    html += `<label class="form-field"><span>${escapeHtml(f.label)}${matched?' <b class="fcheck">✓</b>':''}</span>
      <select data-batch-key="${f.key}">
        <option value="">— 不映射 —</option>
        ${headers.map(h=>`<option value="${escapeHtml(h)}" ${h===matched?'selected':''}>${escapeHtml(h)}</option>`).join('')}
      </select></label>`;
  });
  if (lastGroup) html += '</div>';
  box.innerHTML = html;
}

function renderBatchPreview() {
  const box = document.getElementById('batchPreview');
  if (!batchRows.length || !batchHeaders.length) { box.innerHTML='<p class="empty">无数据</p>'; return; }
  const preview = batchRows.slice(0,3);
  let html = '<table class="data-table"><thead><tr>' + batchHeaders.map(h=>`<th>${escapeHtml(h)}</th>`).join('') + '</tr></thead><tbody>';
  preview.forEach(row=>{
    html += '<tr>' + batchHeaders.map(h=>`<td>${escapeHtml(String(row[h]??''))}</td>`).join('') + '</tr>';
  });
  html += '</tbody></table>';
  box.innerHTML = html;
}

function refreshSavedMappingSelect() {
  const sel = document.getElementById('savedMapping');
  const list = loadMappings();
  sel.innerHTML = '<option value="">— 载入已保存的映射 —</option>' +
    list.map((m,i)=>`<option value="${i}">${escapeHtml(m.name)}</option>`).join('');
}

function getCurrentMapping() {
  const mapping = {};
  document.querySelectorAll('select[data-batch-key]').forEach(s=>{ if(s.value) mapping[s.dataset.batchKey]=s.value; });
  return mapping;
}
function saveCurrentMapping() {
  const name = prompt('给这套映射起个名字（方便下次同类表格复用）：');
  if (!name) return;
  const list = loadMappings();
  list.push({ name:name.trim(), mapping:getCurrentMapping() });
  saveMappings(list);
  refreshSavedMappingSelect();
  toast('映射已保存','success');
}
function deleteSavedMapping() {
  const sel = document.getElementById('savedMapping');
  const idx = parseInt(sel.value,10);
  if (isNaN(idx)) { toast('请先选择要删除的映射','error'); return; }
  const list = loadMappings();
  list.splice(idx,1);
  saveMappings(list);
  refreshSavedMappingSelect();
  toast('映射已删除','success');
}
function loadSavedMapping() {
  const sel = document.getElementById('savedMapping');
  const idx = parseInt(sel.value,10);
  if (isNaN(idx)) return;
  const m = loadMappings()[idx];
  if (!m) return;
  document.querySelectorAll('select[data-batch-key]').forEach(s=>{
    s.value = m.mapping[s.dataset.batchKey] || '';
  });
  toast(`已载入映射「${m.name}」`,'success');
}

async function doBatchGenerate() {
  const tplId = document.getElementById('batchTemplate').value;
  const t = getTemplate(tplId);
  if (!t) { toast('请选择模板','error'); return; }
  if (!batchRows.length) { toast('请先上传订单明细','error'); return; }
  const mapping = getCurrentMapping();
  const zip = new JSZip();
  let count=0;
  const status = document.getElementById('batchStatus');
  status.style.display='block';
  for (let i=0;i<batchRows.length;i++){
    status.textContent = `生成中 ${i+1}/${batchRows.length}…`;
    const row = batchRows[i];
    const fields = {}, itemDefaults = {};
    Object.entries(mapping).forEach(([k,col])=>{
      const val = row[col]!=null ? String(row[col]).trim() : '';
      if (['product_name','brand_model','boxes','net_weight','gross_weight','pallet','unit_price','quantity','total_amount','hs_code'].includes(k)) itemDefaults[k]=val;
      else fields[k]=val;
    });
    // 地址：优先用合并地址；否则由地址1+地址2拼接（过滤 - 占位）
    if (!fields.address) {
      const parts = [fields.address1, fields.address2].filter(v=>v && v!=='-' && v!=='N/A');
      if (parts.length) fields.address = parts.join('\n');
    }
    fields.country = countryToCode(fields.country);
    if (state.settings.phoneStripPlus) fields.phone = stripPhone(fields.phone);
    fields.date = fields.date || todayStr();
    try {
      const { buffer, fileName } = await generateInvoiceExcel(t, fields, itemDefaults, '');
      zip.file(fileName, buffer);
      count++;
    } catch(e){ console.error('row',i,e); }
    if (i%3===0) await new Promise(r=>setTimeout(r,0));
  }
  status.textContent = `正在打包 ${count} 个文件…`;
  const zbuf = await zip.generateAsync({type:'arraybuffer'});
  const blob = new Blob([zbuf],{type:'application/zip'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download=`invoices_${todayStr()}.zip`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  status.textContent = `完成：成功生成 ${count}/${batchRows.length} 份发票`;
  // 批量也写入生成记录
  batchRows.slice(0,count).forEach((row,i)=>{
    const f = {};
    Object.entries(mapping).forEach(([k,col])=>{ f[k]=row[col]!=null?String(row[col]).trim():''; });
    state.records.push({ time:new Date().toLocaleString('zh-CN'), ts:Date.now(), templateId:t.id, templateName:t.name, fields:f, fileName:'批量-'+(f.platformOrder||f.orderNo||i), recipient:f.recipient, platformOrder:f.platformOrder, trackingNo:f.trackingNo });
  });
  saveRecords();
  toast(`批量生成完成，共 ${count} 份`,'success');
}

/* ---------- 模板文件上传 ---------- */
/* ---------- 智能识别模板结构 ---------- */
// 判断单元格是否为合并区域的主单元格（左上角）
function isMergeMaster(ws, addr) {
  for (const m of ws.model.merges) {
    const parts = String(m).split(':');
    const start = parts[0]; // 合并区左上角，如 "A1"
    if (parts.length===2 && inRange(addr, parts[0], parts[1])) return addr === start;
  }
  return true;
}
function colToNum(col) { let n=0; for(const ch of col) n=n*26+(ch.charCodeAt(0)-64); return n; }
function inRange(addr, start, end) {
  const parse=a=>{ const m=a.match(/([A-Z]+)(\d+)/); return {c:colToNum(m[1]),r:+m[2]}; };
  const a=parse(addr), s=parse(start), e=parse(end);
  return a.c>=s.c && a.c<=e.c && a.r>=s.r && a.r<=e.r;
}
function isYellowCell(cell) {
  try {
    const f = cell.fill && cell.fill.fgColor ? (cell.fill.fgColor.argb||'') : '';
    return /FFFF00/i.test(f);
  } catch(e) { return false; }
}
// 从单元格值里取可读文本（处理富文本/日期/对象）
function cellText(v) {
  if (v==null) return '';
  if (typeof v==='string') return v.trim();
  if (v instanceof Date) return v.toISOString().slice(0,10);
  if (v.richText) return v.richText.map(t=>t.text).join('').trim();
  // 超链接单元格：{ text: { richText: [...] }, hyperlink: ... }
  if (v.text && typeof v.text==='object' && v.text.richText) return v.text.richText.map(t=>t.text).join('').trim();
  if (v.text) return String(v.text).trim();
  if (typeof v==='object' && v.result!==undefined) return String(v.result).trim();
  return String(v).trim();
}
// 标签 → 字段 key
function matchFieldKey(label) {
  if (!label) return '';
  const norm = label.toLowerCase().replace(/[：:\s_\-().,'"']/g,' ').replace(/\s+/g,' ').trim().replace(/[()（）]/g,'');
  const flat = s => s.toLowerCase().replace(/[\s_\-/.]/g,'');
  const ns = flat(norm);
  if (!ns) return '';
  const entries = [];
  for (const [key, aliases] of Object.entries(FIELD_LABEL_ALIASES)) {
    for (const a of aliases) entries.push({ key, na:flat(a) });
  }
  // 先精确匹配，避免 "product" 抢占 "product customs code" 这类长表头
  const exact = entries.find(e => e.na === ns);
  if (exact) return exact.key;
  // 再包含匹配，按别名长度降序取最具体的一个
  const candidates = entries.filter(e => e.na && ns.includes(e.na)).sort((a,b)=>b.na.length-a.na.length);
  return candidates.length ? candidates[0].key : '';
}
// 标签词库：归一化后精确匹配。模板里这些词是"字段名/表头"，不是固定内容
const TEMPLATE_LABEL_WORDS = new Set([
  // 收件 / 发货 / 卖方信息标签
  'recipient','recipientsname','consignee','customer','customername','name',
  'company','companyname','recipientcompany','consigneecompany','收件人公司','公司名','公司名称',
  'address','address1','address2','street','addr',
  'city','town','province','state','provincestate','region',
  'postcode','postalcode','zip','zipcode',
  'country','countryregion',
  'telephone','telephonenumber','phonenumber','phone','tel','mobile',
  'email','emailaddress','eori','eorino','vat','vatno','taxno',
  'soldby','shipper','shipfrom','shipto','billto','seller','buyer','from','to',
  'tracking','trackingno','trackingnumber','跟踪单号','跟踪号','追踪号','物流单号','运单号','waybill','waybillno',
  'date','invoicedate','no','orderno','ordernumber',
  '收件人','收件人姓名','客户','地址','详细地址','城市','城市名称','省州','省','邮编','邮政编码',
  '国家','国家地区','电话','联系电话','日期','开票日期','税号','序号',
  // 商品明细表头
  'productname','product','commodities','commodity','item','品名','产品名称','商品名称',
  'brandandmodel','brand','model','品牌型号','品牌',
  'boxespiecesctn','boxes','pieces','ctn','箱数','件数',
  'netweightkg','netweight','netwt','净重',
  'grossweightkg','grossweight','grosswt','毛重',
  'pallet','托盘',
  'declaredunitpriceofproduct','declaredunitprice','unitprice','申报单价','单价',
  'declaredquantityofproduct','declaredquantity','quantity','qty','申报数量','数量',
  'totaldeclaredamount','declaredamount','totalamount','total','申报总额','总额',
  'productcustomscode','customscode','hscode','hs','海关编码',
  // 标题
  'proformainvoice','profomalinvoice','profomalinvoices','invoice','packinglist','commercialinvoice','商业发票','形式发票'
]);
function normLabel(s) { return String(s||'').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g,''); }
function numToCol(n) { let s=''; while(n>0){ const m=(n-1)%26; s=String.fromCharCode(65+m)+s; n=Math.floor((n-1)/26); } return s; }
const ITEM_FIELD_KEYS = new Set(['product_name','brand_model','boxes','net_weight','gross_weight','pallet','unit_price','quantity','total_amount','hs_code']);

/* ===== 语义识别：标签与值同格 / 合成地址 ===== */
// 把 "Name (姓名) :LYMOW..." 拆成 { label, prefix, value }
// prefix 含标签+冒号+原有空格，写入时保留，只替换后面的值
function splitLabelValue(text) {
  if (!text) return null;
  // 全角/半角冒号，取第一个冒号作为分隔
  const m = String(text).match(/^(.*?[：:])([ \t]*)(.*)$/s);
  if (!m) return null;
  const label = m[1].replace(/[：:]$/,'').trim();
  const prefix = m[1] + (m[2] || ''); // 含冒号及原有空格
  const value = (m[3] || '').trim();
  return { label, prefix, value };
}
// 从一整行地址里拆出 街道/邮编/城市/国家（合成字段的组成部分）
function splitCompositeAddress(text) {
  if (!text) return null;
  const parts = String(text).split(/\s*[,，]\s*/).filter(Boolean);
  if (parts.length < 2) return null;
  let postcode = '', country = '', countryRaw = '';
  // 国家：从最后几段里匹配国家字典；邮编：匹配各国邮编格式
  for (let i = parts.length - 1; i >= Math.max(0, parts.length - 3); i--) {
    const seg = parts[i];
    for (const [name, code] of Object.entries(COUNTRY_CODE_MAP)) {
      if (name.length > 2 && seg.toLowerCase().includes(name)) {
        country = code; countryRaw = seg; break;
      }
    }
    if (country) { parts.splice(i, 1); break; }
  }
  for (let i = 0; i < parts.length; i++) {
    if (POSTCODE_PATTERNS.some(re => re.test(parts[i]) && new RegExp('^'+parts[i].replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$').test(parts[i]))) {
      postcode = parts[i]; parts.splice(i, 1); break;
    }
  }
  const city = parts.length ? parts[parts.length - 1] : '';
  const street = parts.slice(0, Math.max(0, parts.length - 1)).join(', ');
  if (!street && !city && !postcode) return null;
  return { street, postcode, city, country, countryRaw };
}

// 核心：扫描 workbook，返回字段映射、商品明细映射、固定内容
function analyzeTemplateWorkbook(wb) {
  const ws = wb.worksheets[0];
  const result = {
    fieldDefs:[], cellMap:{}, fixedValues:{}, sheetName:ws.name,
    yellowCells:[], fixedCells:[], itemRow:0, headerRow:0, itemCellMap:{}
  };
  const yellowAddrs = new Set();   // 黄色单元格本身
  const labelAddrs  = new Set();   // 黄色单元格左侧的标签单元格
  const semanticAddrs = new Set(); // 语义识别为字段的单元格（含标签+值同格）
  result.cellPrefix = {};   // 字段 key → 保留的前缀（标签+冒号）
  result.composite  = null; // 合成地址字段：{ cell, parts, join }

  // 第一遍：识别黄色可变字段，同时收集需要排除的标签地址
  ws.eachRow((row, rowNumber) => {
    row.eachCell((cell, colNumber) => {
      if (!isMergeMaster(ws, cell.address)) return;
      const val = cellText(cell.value);
      if (!isYellowCell(cell)) return;
      yellowAddrs.add(cell.address);
      const leftLabel = colNumber>1 ? cellText(ws.getCell(rowNumber, colNumber-1).value) : '';
      if (colNumber>1) labelAddrs.add(ws.getCell(rowNumber, colNumber-1).address);

      // 标签来源优先级：① 格内自带"标签:值" → 用它（标签值同格场景）
      //              ② 左侧单元格标签（KaiLe 场景）
      const sp = splitLabelValue(val);
      let labelSource = '', key = '', prefix = '';
      const spValid = sp && sp.label && sp.label.length<=30; // 过长的是说明句，不是字段标签
      if (spValid && matchFieldKey(sp.label)) {
        labelSource = sp.label; key = matchFieldKey(sp.label); prefix = sp.prefix;
        if (!result.cellPrefix[key]) result.cellPrefix[key] = prefix; // 首个匹配为准
        // 地址本身是一整行 → 合成字段
        if (key === 'address' && sp.value && splitCompositeAddress(sp.value)) {
          const parsed = splitCompositeAddress(sp.value);
          result.composite = { cell:cell.address, parts:['address','postcode','city','province','country'], join:', ',
            countryStyle: parsed.countryRaw && /[a-z]{3,}/i.test(parsed.countryRaw) ? 'full' : 'code', valueText: sp.value };
        }
      } else {
        // 标签在上方（如 F7 "详细地址" → F8 地址值）
        const aboveText = rowNumber>1 ? cellText(ws.getCell(rowNumber-1, colNumber).value) : '';
        const aboveSp = splitLabelValue(aboveText);
        const aboveLabel = aboveSp && aboveSp.label ? aboveSp.label : aboveText;
        // 地址值本身是一整行 → 合成字段（标签取上方）
        if (splitCompositeAddress(val) && matchFieldKey(aboveLabel)==='address') {
          const parsed = splitCompositeAddress(val);
          labelSource = aboveLabel; key = 'address';
          const pfx = aboveSp ? aboveSp.prefix : '';
          result.cellPrefix.address = pfx;
          result.composite = { cell:cell.address, parts:['address','postcode','city','province','country'], join:', ',
            countryStyle: parsed.countryRaw && /[a-z]{3,}/i.test(parsed.countryRaw) ? 'full' : 'code', valueText: val };
          prefix = pfx;
          labelAddrs.add(ws.getCell(rowNumber-1, colNumber).address);
        } else {
          labelSource = leftLabel;
          key = matchFieldKey(labelSource);
        }
      }
      if (!key) key = 'custom_' + rowNumber + '_' + colNumber;
      const group = ['orderNo','date','platformOrder','note'].includes(key) ? '订单信息' : '收件信息';
      const displayLabel = labelSource || val.slice(0,20) || key;
      result.yellowCells.push({ addr:cell.address, label:displayLabel, key, prefix, value: sp?sp.value:'' });
      // 去重：同一 key 只保留首个单元格
      if (!result.cellMap[key]) {
        result.cellMap[key] = cell.address;
        result.fieldDefs.push({ key, label:displayLabel, group, cell:cell.address, prefix, sample:sp?sp.value:'' });
      }
    });
  });

  // 合成地址：把各组成部分作为字段加入核对表单（地址本身已在上面作为字段加入，跳过）
  if (result.composite) {
    const seen = new Set(result.fieldDefs.map(f=>f.key));
    [['postcode','邮编'],['city','城市'],['province','省/州'],['country','国家/地区']].forEach(([k,label])=>{
      if (!seen.has(k)) { result.fieldDefs.push({ key:k, label, group:'收件信息', cell:'', compositePart:true }); seen.add(k); }
    });
  }

  // 语义遍：扫描"标签:值"同格但没有标黄的字段（补充黄色遍）
  {
    const seenKeys = new Set(Object.keys(result.cellMap));
    ws.eachRow((row, rowNumber) => {
      row.eachCell((cell, colNumber) => {
        if (!isMergeMaster(ws, cell.address)) return;
        const addr = cell.address;
        const sp = splitLabelValue(cellText(cell.value));
        if (!sp || !sp.label || sp.label.length>30) return;
        const key = matchFieldKey(sp.label);
        if (!key || seenKeys.has(key)) return;

        // 合成地址：标签是"详细地址"，格内值本身像一整行地址 → 记为合成字段
        if (key === 'address' && sp.value && splitCompositeAddress(sp.value)) {
          const parsed = splitCompositeAddress(sp.value);
          // 模板里国家写全称（Switzerland）还是代码（CH）
          const countryStyle = parsed.countryRaw && /[a-z]{3,}/i.test(parsed.countryRaw) ? 'full' : 'code';
          result.composite = { cell: addr, parts: ['address','postcode','city','province','country'], join:', ', countryStyle, valueText: sp.value };
          result.cellMap.address = addr;
          result.cellPrefix.address = sp.prefix;
          result.fieldDefs.push({ key:'address', label:sp.label, group:'收件信息', cell:addr, composite:true });
          seenKeys.add('address'); semanticAddrs.add(addr);
          return;
        }
        // 普通标签值同格：记住前缀，值留给用户填写
        result.cellMap[key] = addr;
        result.cellPrefix[key] = sp.prefix;
        const group = ['orderNo','date','platformOrder','note'].includes(key) ? '订单信息' : '收件信息';
        result.fieldDefs.push({ key, label:sp.label, group, cell:addr, prefix:sp.prefix, sample:sp.value });
        seenKeys.add(key); semanticAddrs.add(addr);
        result.yellowCells.push({ addr, label:sp.label, key, prefix:sp.prefix, value:sp.value });
      });
    });
    // 合成地址：把各组成部分作为字段加入，供核对表单填写
    if (result.composite) {
      const defsSeen = new Set(result.fieldDefs.map(f=>f.key));
      const parts = [['postcode','邮编'],['city','城市'],['province','省/州'],['country','国家/地区']];
      parts.forEach(([k,label]) => {
        if (!defsSeen.has(k)) { result.fieldDefs.push({ key:k, label, group:'收件信息', cell:'', compositePart:true }); defsSeen.add(k); }
      });
    }
  }

  // 第二遍：找商品明细表头行（匹配到商品字段最多的一行）
  const SEQ_LABELS = new Set(['no','序号','itemno','num','number','编号','#']);
  let bestRow = 0, bestScore = 0, bestMap = {}, bestSeqCol = 0;
  ws.eachRow((row, rowNumber) => {
    let score = 0, seqCol = 0; const map = {};
    row.eachCell((cell, colNumber) => {
      const t = cellText(cell.value);
      if (!t) return;
      if (SEQ_LABELS.has(normLabel(t))) seqCol = seqCol ? Math.min(seqCol, colNumber) : colNumber;
      const key = matchFieldKey(t);
      if (ITEM_FIELD_KEYS.has(key)) { score++; map[colNumber] = key; }
    });
    if (score > bestScore) { bestScore = score; bestRow = rowNumber; bestMap = map; bestSeqCol = seqCol; }
  });
  if (bestScore >= 2) {
    result.headerRow = bestRow;
    result.itemRow = bestRow + 1;
    Object.entries(bestMap).forEach(([cn,key]) => {
      result.itemCellMap[key] = numToCol(+cn) + result.itemRow;
    });
    // 序号列：优先用明确的 "NO./序号" 表头列；否则取第一个商品字段的前一列
    const firstCol = Math.min(...Object.keys(bestMap).map(Number));
    const seqCol = bestSeqCol || Math.max(1, firstCol-1);
    result.itemCellMap.item_no = numToCol(seqCol) + result.itemRow;
  }

  // 第三遍：固定内容 = 非黄色、有值、且不是"标签/表头/商品数据/标题"的单元格
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // 第一行通常是大标题
    row.eachCell((cell, colNumber) => {
      if (!isMergeMaster(ws, cell.address)) return;
      const addr = cell.address;
      if (yellowAddrs.has(addr) || labelAddrs.has(addr) || semanticAddrs.has(addr)) return;
      const val = cellText(cell.value);
      if (!val || val.length < 2) return;
      // "标签:"形态且标签能匹配字段的格（如 F7 详细地址标签、空值标签格），不作为固定内容
      const sp = splitLabelValue(val);
      if (sp && sp.label && matchFieldKey(sp.label)) return;
      if (TEMPLATE_LABEL_WORDS.has(normLabel(val))) return;   // 字段名/表头/标题
      if (result.itemRow && rowNumber === result.itemRow) return; // 商品数据行已映射
      result.fixedCells.push({ addr, value:val });
      result.fixedValues[addr] = val;
    });
  });

  result.detectedCount = result.fieldDefs.filter(f=>!f.key.startsWith('custom_')).length;
  return result;
}

async function onTemplateFileUpload(input, tplId) {
  const file = input.files[0]; if(!file) return;
  const t = getTemplate(tplId); if(!t) return;
  const reader = new FileReader();
  reader.onload = async () => {
    // 存到 localStorage（base64）
    const b64 = btoa(String.fromCharCode(...new Uint8Array(reader.result)));
    t.fileData = b64;
    t.fileName = 'uploaded:' + file.name;
    t.uploadedName = file.name;
    // 智能识别模板结构
    let analyze = null;
    try {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(reader.result.slice(0));
      analyze = analyzeTemplateWorkbook(wb);
      t.sheetName = analyze.sheetName;
      if (analyze.fieldDefs.length) {
        t.fieldDefs = analyze.fieldDefs;
        t.cellMap = analyze.cellMap;
      }
      t.cellPrefix = analyze.cellPrefix || {};
      t.composite = analyze.composite || null;
      // 新模板以识别结果为准（即使为空，避免残留上一个模板的固定内容）
      t.fixedValues = analyze.fixedValues;
      if (analyze.itemRow) t.itemRow = analyze.itemRow;
      if (Object.keys(analyze.itemCellMap).length) t.itemCellMap = analyze.itemCellMap;
    } catch(e) { console.error('模板识别失败', e); }
    saveTemplates();
    // 把识别结果填入编辑框供核对
    if (analyze && analyze.fieldDefs.length) {
      openTplEditor(t.id);
      const nItem = Object.keys(analyze.itemCellMap).length;
      toast(`已智能识别：${analyze.detectedCount} 个字段${nItem?`、${nItem} 项商品明细`:''}、${Object.keys(analyze.fixedValues).length} 项固定内容，请核对`, 'success');
    } else {
      toast('模板文件已上传（未能自动识别字段，请手动配置）','info');
    }
    renderTemplateList();
  };
  reader.readAsArrayBuffer(file);
}

/* 覆盖 fetch：支持 uploaded: 前缀的本地 base64 模板 */
const _origFetch = window.fetch.bind(window);
window.fetch = function(url, opts) {
  if (typeof url==='string' && url.startsWith('uploaded:')) {
    // 文件名可能含 # 等字符，generateInvoiceExcel 会逐段 encodeURIComponent，这里需解码回来
    let name = url.slice(9);
    try { name = decodeURIComponent(name); } catch(e) {}
    const t = state.templates.find(x=>x.uploadedName===name);
    if (t && t.fileData) {
      const bin = atob(t.fileData);
      const arr = new Uint8Array(bin.length);
      for(let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
      return Promise.resolve(new Response(arr.buffer, {status:200}));
    }
    return Promise.resolve(new Response(null,{status:404}));
  }
  return _origFetch(url, opts);
};

/* ---------- 模板可视化点选 ---------- */
let _previewWb = null;      // 当前预览的 workbook
let _previewTemplateId = null;
let _selectedAddr = null;

async function loadTemplatePreview() {
  const id = document.getElementById('tplEditId').value;
  const t = getTemplate(id); if(!t) return;
  const box = document.getElementById('tplPreview');
  box.innerHTML = '<p class="hint">正在加载模板预览…</p>';
  try {
    let buf;
    if (t.fileData) {
      const bin = atob(t.fileData);
      const arr = new Uint8Array(bin.length);
      for(let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
      buf = arr.buffer;
    } else if (t.fileName) {
      const url = t.fileName.startsWith('uploaded:')
        ? t.fileName : t.fileName.split('/').map(encodeURIComponent).join('/');
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('无法读取模板文件');
      buf = await resp.arrayBuffer();
    } else { throw new Error('请先上传模板文件'); }
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    _previewWb = wb; _previewTemplateId = id;
    renderTemplateGrid();
  } catch(e) {
    box.innerHTML = `<p class="ocr-warn">预览加载失败：${escapeHtml(e.message)}</p>`;
  }
}

function renderTemplateGrid() {
  const box = document.getElementById('tplPreview');
  const t = getTemplate(_previewTemplateId);
  const ws = _previewWb.getWorksheet(t.sheetName) || _previewWb.worksheets[0];
  const maxR = Math.min(ws.rowCount || ws.actualRowCount || 25, 40);
  const maxC = Math.min(ws.columnCount || 12, 16);
  const cellMap = t.cellMap || {}, prefix = t.cellPrefix || {}, fixed = t.fixedValues || {};
  const addrToField = {};
  Object.entries(cellMap).forEach(([k,c])=>{ if(c) addrToField[c]=k; });
  let html = '<div class="tpl-preview-wrap"><table class="tpl-grid"><thead><tr><th></th>';
  for(let c=1;c<=maxC;c++) html += `<th>${numToCol(c)}</th>`;
  html += '</tr></thead><tbody>';
  for(let r=1;r<=maxR;r++){
    html += `<tr><th>${r}</th>`;
    for(let c=1;c<=maxC;c++){
      const cell = ws.getCell(r,c);
      const addr = cell.address;
      const txt = escapeHtml(cellText(cell.value).slice(0,40));
      const cls = [addrToField[addr]?'tpl-mapped':'', fixed[addr]!==undefined?'tpl-fixed':'', isYellowCell(cell)?'tpl-yellow':''].filter(Boolean).join(' ');
      const title = addrToField[addr] ? `字段: ${addrToField[addr]}` : (fixed[addr]!==undefined?'固定内容':'');
      const sel = _selectedAddr===addr ? ' style="outline:2px solid #2563eb;outline-offset:-2px"' : '';
      html += `<td class="${cls}" title="${escapeHtml(title)}" data-addr="${addr}" onclick="pickTplCell('${addr}')"${sel}>${txt}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table></div>';
  html += `<div class="tpl-pick-bar" id="tplPickBar"></div>`;
  box.innerHTML = html;
}

function pickTplCell(addr) {
  _selectedAddr = addr;
  const t = getTemplate(_previewTemplateId);
  const cellMap = t.cellMap || {}, prefix = t.cellPrefix || {};
  const curField = Object.entries(cellMap).find(([k,c])=>c===addr);
  const fieldKey = curField ? curField[0] : '';
  // 可选字段：字段字典 + 模板自定义字段 + 合成字段
  const keys = new Set([...FIELD_SCHEMA.map(f=>f.key), ...BATCH_FIELDS.map(f=>f.key), ...getFieldDefs(t).map(f=>f.key)]);
  let opts = '<option value="">（不作为字段）</option>';
  [...keys].forEach(k => { opts += `<option value="${escapeHtml(k)}" ${k===fieldKey?'selected':''}>${escapeHtml(k)}</option>`; });
  const bar = document.getElementById('tplPickBar');
  bar.innerHTML = `<span class="addr">${addr}</span>
    <label>字段：<select id="pickField">${opts}</select></label>
    <label>保留前缀：<input type="text" id="pickPrefix" style="width:160px" value="${escapeHtml(prefix[fieldKey]||'')}" placeholder="如 Name :"></label>
    <button type="button" class="btn btn-sm btn-primary" onclick="applyTplPick()">应用</button>
    <button type="button" class="btn btn-sm" onclick="applyTplPick(true)">设为固定内容</button>`;
  // 高亮重绘（不重置 bar）
  document.querySelectorAll('#tplPreview td.tpl-grid-cell, #tplPreview td[data-addr]').forEach(td=>{
    td.style.outline = td.dataset.addr===addr ? '2px solid #2563eb' : '';
  });
}

function applyTplPick(asFixed) {
  if (!_selectedAddr) return;
  const t = getTemplate(_previewTemplateId);
  const addr = _selectedAddr;
  const fieldKey = document.getElementById('pickField').value;
  const prefixVal = document.getElementById('pickPrefix').value;
  t.cellMap = t.cellMap || {}; t.cellPrefix = t.cellPrefix || {}; t.fieldDefs = t.fieldDefs || [];
  t.fixedValues = t.fixedValues || {};
  // 先移除该地址上的旧映射
  Object.keys(t.cellMap).forEach(k => { if (t.cellMap[k]===addr) { delete t.cellMap[k]; delete t.cellPrefix[k]; } });
  delete t.fixedValues[addr];
  t.fieldDefs = t.fieldDefs.filter(f => f.cell !== addr);
  if (asFixed) {
    const txt = cellText(_previewWb.getWorksheet(t.sheetName).getCell(addr).value);
    t.fixedValues[addr] = txt;
  } else if (fieldKey) {
    t.cellMap[fieldKey] = addr;
    if (prefixVal) t.cellPrefix[fieldKey] = prefixVal;
    if (!t.fieldDefs.find(f=>f.key===fieldKey)) {
      const def = FIELD_SCHEMA.find(x=>x.key===fieldKey) || BATCH_FIELDS.find(x=>x.key===fieldKey);
      t.fieldDefs.push({ key:fieldKey, label:def?def.label:fieldKey, group:def?def.group:'自定义字段', cell:addr });
    }
  }
  saveTemplates();
  // 同步到编辑表
  openTplEditor(t.id);
  renderTemplateGrid();
  toast('已更新单元格配置，记得点"保存配置"','success');
}

/* ---------- 初始化 ---------- */
document.addEventListener('DOMContentLoaded', () => {
  loadState();
  renderTemplateSelect('genTemplate');
  renderTemplateSelect('batchTemplate');
  document.querySelectorAll('.nav-item').forEach(n => n.addEventListener('click', ()=>switchView(n.dataset.view)));
  // 单笔生成按钮
  document.getElementById('btnGenerate').addEventListener('click', doGenerate);
  // 识别文字修正后重新解析
  document.getElementById('btnParseText').addEventListener('click', onPasteParse);
  document.getElementById('screenshotInput').addEventListener('change', e=>onScreenshotUpload(e.target));
  // 批量
  document.getElementById('batchInput').addEventListener('change', e=>onBatchExcelUpload(e.target));
  document.getElementById('btnReloadSheet').addEventListener('click', refreshBatchData);
  document.getElementById('batchSheet').addEventListener('change', refreshBatchData);
  document.getElementById('btnSaveMapping').addEventListener('click', saveCurrentMapping);
  document.getElementById('btnDeleteMapping').addEventListener('click', deleteSavedMapping);
  document.getElementById('savedMapping').addEventListener('change', loadSavedMapping);
  // 切换模板时重渲染映射，以显示该模板的自定义字段
  document.getElementById('batchTemplate').addEventListener('change', ()=>{ if (batchHeaders.length) renderBatchMapping(batchHeaders, {}); });
  document.getElementById('btnBatchGenerate').addEventListener('click', doBatchGenerate);
  // 模板管理
  document.getElementById('btnAddTemplate').addEventListener('click', addNewTemplate);
  document.getElementById('btnSaveTpl').addEventListener('click', saveTplEditor);
  document.getElementById('btnCloseTpl').addEventListener('click', closeTplEditor);
  document.getElementById('tplFileInput').addEventListener('change', e=>{
    const id = document.getElementById('tplEditId').value;
    if(id) onTemplateFileUpload(e.target, id);
  });
  document.getElementById('btnPreviewTpl').addEventListener('click', loadTemplatePreview);
  // 生成记录清理
  document.getElementById('btnClearOldRecords').addEventListener('click', clearOldRecords);
  document.getElementById('btnClearAllRecords').addEventListener('click', clearAllRecords);
  // 设置
  document.getElementById('btnSaveSettings').addEventListener('click', saveSettingsFromUI);
  document.getElementById('btnAddSetting').addEventListener('click', addCustomSetting);

});
