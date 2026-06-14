/* =========================================================================
   ATLAS Utility Web — app.css
   Visual identity: the freight manifest. Navy ink on cool paper, condensed
   placard type for headings, monospace for codes (WMTR reads like a
   container marking), cargo orange reserved for the route strip + actions.
   ========================================================================= */

:root{
  --ink: #16283C;        /* manifest navy */
  --ink-2: #23364D;
  --steel: #5B6B7C;
  --paper: #EFF1F3;      /* cool gray paper */
  --card: #FFFFFF;
  --line: #D4DAE0;
  --accent: #E8590C;     /* cargo orange */
  --accent-dark: #C74A08;
  --cleared: #1E7F4F;    /* status green */
  --warn: #B00000;

  --disp: "Barlow Condensed", "Arial Narrow", Arial, sans-serif;
  --body: -apple-system, "Segoe UI", system-ui, Roboto, Arial, sans-serif;
  --mono: "IBM Plex Mono", Consolas, "Courier New", monospace;
}

*{ box-sizing: border-box; }
html, body{ margin:0; padding:0; height:100%; }
body{
  font-family: var(--body);
  font-size: 14px;
  color: var(--ink);
  background: var(--paper);
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ---------- Top band ---------- */
.topbar{
  background: var(--ink);
  color: #fff;
  display: flex;
  align-items: baseline;
  gap: 14px;
  padding: 12px 22px 10px;
  border-bottom: 3px solid var(--accent);
}
.topbar .brand{
  font-family: var(--disp);
  font-weight: 600;
  font-size: 26px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
}
.topbar .ver{
  font-family: var(--mono);
  font-size: 11px;
  color: #9FB0C2;
  letter-spacing: 1px;
}
.topbar .tagline{
  margin-left: auto;
  font-size: 12px;
  color: #9FB0C2;
}

/* ---------- Layout ---------- */
.layout{
  display: grid;
  grid-template-columns: 250px 1fr;
  grid-template-rows: minmax(0, 1fr);
  gap: 0;
  flex: 1 1 auto;
  min-height: 0;       /* allow children to scroll inside the flex column */
  overflow: hidden;
}
@media (max-width: 900px){
  .layout{ grid-template-columns: 1fr; overflow: visible; }
  /* On narrow screens fall back to normal page scrolling. */
  body{ height: auto; min-height: 100vh; overflow: auto; }
  .rail, .main{ overflow: visible; }
}

/* ---------- Tool rail ---------- */
.rail{
  background: var(--card);
  border-right: 1px solid var(--line);
  padding: 18px 14px 30px;
  overflow-y: auto;    /* stays fixed in place; scrolls internally if needed */
  min-height: 0;
}
.rail h3{
  font-family: var(--disp);
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: var(--steel);
  margin: 18px 4px 8px;
}
.rail h3:first-child{ margin-top: 2px; }

.toolbtn{
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  text-align: left;
  background: none;
  border: 1px solid transparent;
  border-radius: 6px;
  padding: 8px 10px;
  font-family: var(--body);
  font-size: 13.5px;
  color: var(--ink);
  cursor: pointer;
}
.toolbtn .dot{
  width: 7px; height: 7px;
  border-radius: 50%;
  background: var(--line);
  flex: 0 0 auto;
}
.toolbtn:hover:not(:disabled){ background: #F2F5F8; border-color: var(--line); }
.toolbtn.active{ background: #FDEFE6; border-color: var(--accent); }
.toolbtn.active .dot{ background: var(--accent); }
.toolbtn.ready .dot{ background: var(--cleared); }
.toolbtn:disabled{ color: #A9B4BF; cursor: not-allowed; }
.toolbtn:focus-visible{ outline: 2px solid var(--accent); outline-offset: 1px; }
.toolbtn .soon{
  margin-left: auto;
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: .5px;
  color: #A9B4BF;
  border: 1px solid var(--line);
  border-radius: 3px;
  padding: 1px 4px;
}

/* ---------- Main column (the scrolling pane) ---------- */
.main{
  padding: 22px 26px 60px;
  overflow-y: auto;    /* the right ~80% scrolls; rail + topbar stay put */
  min-height: 0;
}
.main > *{ max-width: 1180px; }

/* ---------- Drop zone ---------- */
.dropzone{
  border: 2px dashed #B9C4CE;
  border-radius: 10px;
  background: var(--card);
  padding: 40px 24px;
  text-align: center;
  cursor: pointer;
  transition: border-color .15s, background .15s;
}
.dropzone.dragover{ border-color: var(--accent); background: #FFF7F2; }
.dropzone:focus-visible{ outline: 2px solid var(--accent); outline-offset: 2px; }
.dropzone .dz-title{
  font-family: var(--disp);
  font-size: 22px;
  font-weight: 600;
  letter-spacing: 1px;
  text-transform: uppercase;
}
.dropzone .dz-sub{ color: var(--steel); margin-top: 6px; font-size: 13px; }
.dropzone.compact{ padding: 12px 18px; display:flex; align-items:center; gap:14px; text-align:left; }
.dropzone.compact .dz-title{ font-size: 15px; }
.dropzone.compact .dz-sub{ margin-top: 0; }
.dz-file{
  font-family: var(--mono);
  font-size: 12px;
  color: var(--ink);
  margin-left: auto;
  background: #F2F5F8;
  border: 1px solid var(--line);
  border-radius: 5px;
  padding: 4px 8px;
  max-width: 46%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---------- Manifest strip (signature element) ---------- */
.manifest{
  margin-top: 16px;
  background: var(--ink);
  color: #fff;
  border-radius: 10px;
  padding: 14px 20px 12px;
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 8px 26px;
  align-items: center;
  position: relative;
  overflow: hidden;
}
.manifest::after{ /* placard corner stripe */
  content: "";
  position: absolute;
  top: 0; right: 0;
  width: 64px; height: 64px;
  background: linear-gradient(135deg, transparent 50%, var(--accent) 50%);
}
.manifest .wmtr{
  font-family: var(--mono);
  font-size: 17px;
  letter-spacing: 1px;
}
.manifest .badge{
  display: inline-block;
  font-family: var(--disp);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 2px;
  text-transform: uppercase;
  border: 1px solid var(--accent);
  color: var(--accent);
  border-radius: 3px;
  padding: 2px 8px;
  margin-left: 12px;
  vertical-align: 2px;
}
.manifest .title{
  grid-column: 1 / -1;
  color: #C7D2DD;
  font-size: 13px;
  margin-top: -2px;
}
.route{
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 6px;
  font-family: var(--disp);
  font-weight: 600;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  font-size: 17px;
}
.route .leg{ white-space: nowrap; }
.route .lane{
  flex: 1;
  height: 0;
  border-top: 2px dashed #586E84;
  position: relative;
}
.route .lane .mode{
  position: absolute;
  top: -11px; left: 50%;
  transform: translateX(-50%);
  background: var(--ink);
  padding: 0 10px;
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 1px;
  color: var(--accent);
  text-transform: none;
}

/* ---------- Stat cards ---------- */
.stats{
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
  margin-top: 12px;
}
.stat{
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 10px 14px;
}
.stat .k{
  font-family: var(--disp);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--steel);
}
.stat .v{ font-size: 16px; font-weight: 600; margin-top: 3px; }
.stat .v.mono{ font-family: var(--mono); font-size: 14px; font-weight: 500; }

/* ---------- Panels & tables ---------- */
.panel{
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 10px;
  margin-top: 16px;
  overflow: hidden;
}
.panel > header{
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 16px;
  border-bottom: 1px solid var(--line);
}
.panel > header h2{
  font-family: var(--disp);
  font-size: 17px;
  font-weight: 600;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  margin: 0;
}
.panel > header .count{
  font-family: var(--mono);
  font-size: 11px;
  color: var(--steel);
}
.panel .body{ padding: 14px 16px; }

.parties{
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: 0;
}
.party{
  padding: 12px 16px;
  border-right: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  font-size: 12.5px;
  line-height: 1.45;
}
.party .plabel{
  font-family: var(--disp);
  font-weight: 600;
  font-size: 12px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--accent-dark);
  margin-bottom: 4px;
}
.party .poc{ color: var(--steel); margin-top: 4px; font-size: 12px; }
.party.empty{ color: #A9B4BF; font-style: italic; }

table.data{
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}
table.data th{
  font-family: var(--disp);
  font-weight: 600;
  font-size: 12px;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: var(--steel);
  text-align: left;
  padding: 7px 10px;
  border-bottom: 2px solid var(--line);
  background: #F7F9FA;
  position: sticky;
  top: 0;
}
table.data td{
  padding: 6px 10px;
  border-bottom: 1px solid #E8ECEF;
  vertical-align: top;
}
table.data td.num{ text-align: right; font-family: var(--mono); font-size: 12px; }
table.data td.mono{ font-family: var(--mono); font-size: 12px; }
.scrollwrap{ max-height: 380px; overflow: auto; }

/* ---------- Tool workspace ---------- */
.workspace{ margin-top: 16px; }
.formgrid{
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px 16px;
}
.field label{
  display: block;
  font-family: var(--disp);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: var(--steel);
  margin-bottom: 4px;
}
.field input[type=text], .field input[type=date],
.field select, .field textarea{
  width: 100%;
  font-family: var(--body);
  font-size: 13.5px;
  color: var(--ink);
  background: #fff;
  border: 1px solid #B9C4CE;
  border-radius: 6px;
  padding: 7px 9px;
}
.field textarea{ resize: vertical; min-height: 56px; }
.field input:focus, .field select:focus, .field textarea:focus{
  outline: 2px solid var(--accent);
  outline-offset: 0;
  border-color: var(--accent);
}
.field .hint{ font-size: 11.5px; color: var(--steel); margin-top: 3px; }
.field.span2{ grid-column: span 2; }
.field.span3{ grid-column: 1 / -1; }
@media (max-width: 700px){ .field.span2{ grid-column: span 1; } }

/* PMR reporting-window controls: fixed columns so the Start/End pickers sit
   directly under the FY/Quarter dropdowns and Run sits right of End, regardless
   of screen width (the shared .formgrid auto-fits its column count, which made
   these reflow). */
.pmr-quick{ margin-bottom: 14px; }
.pmr-qlabel{
  display: block;
  font-family: var(--disp);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: var(--steel);
  margin-bottom: 6px;
}
.pmr-window{
  display: grid;
  grid-template-columns: minmax(130px, 200px) minmax(130px, 200px) max-content;
  gap: 12px 16px;
  align-items: end;
  margin-bottom: 4px;
}
.pmr-window .pmr-runcell button{ width: 100%; }
@media (max-width: 560px){
  .pmr-window{ grid-template-columns: 1fr 1fr; }
  .pmr-spacer{ display: none; }
  .pmr-window .pmr-runcell{ grid-column: 1 / -1; }
}

/* RFQ option rows: checkboxes/radios + an inline comment field */
.field .checkrow{
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 16px;
}
.field .checkrow label.inline{
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-family: var(--body);
  font-size: 13.5px;
  font-weight: 500;
  letter-spacing: 0;
  text-transform: none;
  color: var(--ink);
}
.field .checkrow input[type=checkbox],
.field .checkrow input[type=radio]{
  width: auto;
  margin: 0;
  accent-color: var(--accent);
}
.field .checkrow input[type=text]{ flex: 1 1 200px; }

.btnrow{
  display: flex;
  gap: 10px;
  align-items: center;
  margin-top: 16px;
  flex-wrap: wrap;
}
.btn{
  font-family: var(--disp);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  border-radius: 6px;
  padding: 9px 18px;
  cursor: pointer;
  border: 1px solid transparent;
}
.btn.primary{ background: var(--accent); color: #fff; }
.btn.primary:hover{ background: var(--accent-dark); }
.btn.ghost{ background: #fff; color: var(--ink); border-color: #B9C4CE; }
.btn.ghost:hover{ border-color: var(--ink); }
.btn:focus-visible{ outline: 2px solid var(--ink); outline-offset: 2px; }
.btn:disabled{ opacity: .5; cursor: not-allowed; }

.note{
  font-size: 12px;
  color: var(--steel);
  margin-top: 10px;
  line-height: 1.5;
}

/* ---------- Preview ---------- */
.previewwrap{
  margin-top: 14px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #DDE3E8;
  padding: 14px;
  overflow: auto;
}
.previewwrap iframe{
  display: block;
  width: 1000px;
  height: 770px;
  border: none;
  background: transparent;
  margin: 0 auto;
  transform-origin: top left;
}

/* ---------- Status line ---------- */
.statusline{
  font-family: var(--mono);
  font-size: 12px;
  color: var(--steel);
  margin-top: 10px;
  white-space: pre-wrap;
}
.statusline.err{ color: var(--warn); }

.hidden{ display: none !important; }

@media (prefers-reduced-motion: reduce){
  *{ transition: none !important; animation: none !important; }
}
