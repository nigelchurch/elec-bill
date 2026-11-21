// A pop-up with buttons, built on the HTML <dialog> element.
//
//   const answer = await ask(`<h2>Title</h2><p>Text</p>`, [
//     { value: 'no', label: 'No', secondary: true },
//     { value: 'yes', label: 'Yes' },
//   ]);
//
// Resolves with the tapped button's value, or '' if the pop-up was closed
// another way (e.g. the phone's Back gesture).

export function ask(html, buttons) {
  const dlg = document.createElement('dialog');
  dlg.className = 'summary';
  dlg.innerHTML = `${html}
    <div class="row btn-row">
      ${buttons.map((b) => `<button type="button" value="${b.value}"${b.secondary ? ' class="secondary"' : ''}>${b.label}</button>`).join('')}
    </div>`;
  document.body.appendChild(dlg);
  return new Promise((resolve) => {
    dlg.addEventListener('click', (e) => {
      const v = e.target.closest('button')?.value;
      if (v) dlg.close(v);
    });
    dlg.addEventListener('close', () => { // also fires for the phone's Back gesture
      resolve(dlg.returnValue);
      dlg.remove();
    });
    dlg.showModal(); // a "modal" dialog: the page behind can't be used until it closes
  });
}
