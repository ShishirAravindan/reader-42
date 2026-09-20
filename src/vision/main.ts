// The screens that do not exist yet.
//
// Three things the library could be that the reader never had room for, drawn
// in the shape they would take: the afterpage a finished book leaves behind,
// the year counted honestly, and a commonplace book that only ever speaks when
// spoken to.
//
// The data here is invented and the page says so out loud. This is a pitch,
// not a prototype pretending to be one — the working product is /shelf, and
// nothing in this file touches a real library folder.

interface Mark {
  text: string;
  color: 'yellow' | 'pink' | 'blue' | 'orange';
  note?: string;
  where: string;
}

/** Real passages from The Yellow Wallpaper — the book we actually read. */
const MARKS: Mark[] = [
  {
    text: 'If a physician of high standing, and one’s own husband, assures friends and relatives that there is really nothing the matter with one but temporary nervous depression — a slight hysterical tendency — what is one to do?',
    color: 'yellow',
    note: 'The whole trap, stated in the first page and dressed as reassurance.',
    where: 'Opening · 20 Sep',
  },
  {
    text: 'John laughs at me, of course, but one expects that in marriage.',
    color: 'blue',
    where: 'Opening · 20 Sep',
  },
  {
    text: 'I never saw a worse paper in my life. One of those sprawling flamboyant patterns committing every artistic sin.',
    color: 'yellow',
    where: 'The nursery · 20 Sep',
  },
  {
    text: 'The front pattern does move — and no wonder! The woman behind shakes it!',
    color: 'orange',
    note: 'The turn. She has stopped describing the wall and started describing herself.',
    where: 'Later · 20 Sep',
  },
  {
    text: 'I’ve got out at last, in spite of you and Jane. And I’ve pulled off most of the paper, so you can’t put me back!',
    color: 'pink',
    where: 'The last page · 20 Sep',
  },
];

const FINISHED = [
  ['The Yellow Wallpaper', 'Charlotte Perkins Gilman', '20 Sep'],
  ['Pride and Prejudice', 'Jane Austen', '2 Sep'],
  ['Frankenstein', 'Mary Shelley', '11 Aug'],
  ['The Adventures of Sherlock Holmes', 'Arthur Conan Doyle', '28 Jul'],
  ['Piranesi', 'Susanna Clarke', '9 Jul'],
];

/** A highlight from months ago, with enough provenance to place it. */
const COMMONPLACE = [
  {
    text: 'The Beauty of the House is immeasurable; its Kindness infinite.',
    where: 'Piranesi · Susanna Clarke · marked 4 July, finished 9 July',
  },
  {
    text: 'It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.',
    where: 'Pride and Prejudice · Jane Austen · marked 14 August',
  },
  {
    text: 'Nothing is so painful to the human mind as a great and sudden change.',
    where: 'Frankenstein · Mary Shelley · marked 3 August',
  },
  {
    text: 'The front pattern does move — and no wonder! The woman behind shakes it!',
    where: 'The Yellow Wallpaper · Charlotte Perkins Gilman · marked today',
  },
];

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

function renderAfterpage(): void {
  const list = el('afterpage-marks');
  for (const mark of MARKS) {
    const item = document.createElement('li');
    const dot = document.createElement('div');
    dot.className = `dot ${mark.color}`;
    const body = document.createElement('div');

    const text = document.createElement('div');
    text.className = 't';
    text.textContent = mark.text;
    body.appendChild(text);

    if (mark.note) {
      const note = document.createElement('div');
      note.className = 'n';
      note.textContent = mark.note;
      body.appendChild(note);
    }

    const where = document.createElement('div');
    where.className = 'w';
    where.textContent = mark.where;
    body.appendChild(where);

    item.append(dot, body);
    list.appendChild(item);
  }
}

/**
 * A year of days. Seeded rather than random so the picture is the same every
 * time it is shown — a heatmap that reshuffles on reload is a decoration.
 */
function renderHeatmap(): void {
  const host = el('heatmap');
  let seed = 42;
  const next = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let day = 0; day < 266; day++) {
    const cell = document.createElement('i');
    const roll = next();
    // Reading is streaky, not uniform: most days nothing, some days a lot.
    const value = roll > 0.86 ? 4 : roll > 0.68 ? 3 : roll > 0.46 ? 2 : roll > 0.3 ? 1 : 0;
    if (value > 0) cell.dataset.v = String(value);
    host.appendChild(cell);
  }
}

function renderFinished(): void {
  const list = el('finished-list');
  for (const [title, author, date] of FINISHED) {
    const item = document.createElement('li');
    const names = document.createElement('div');
    const t = document.createElement('div');
    t.className = 'ft';
    t.textContent = title as string;
    const a = document.createElement('div');
    a.className = 'fa';
    a.textContent = author as string;
    names.append(t, a);
    const d = document.createElement('div');
    d.className = 'fd';
    d.textContent = date as string;
    item.append(names, d);
    list.appendChild(item);
  }
}

function renderCommonplace(): void {
  let at = 0;
  const show = (): void => {
    const entry = COMMONPLACE[at % COMMONPLACE.length];
    if (!entry) return;
    el('cp-text').textContent = entry.text;
    el('cp-where').textContent = entry.where;
    at += 1;
  };
  show();
  el('cp-again').onclick = show;
}

function wireViews(): void {
  for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('#views button'))) {
    button.onclick = (): void => {
      for (const other of Array.from(document.querySelectorAll('#views button'))) {
        other.classList.toggle('on', other === button);
      }
      const view = button.dataset.view;
      el('afterpage-view').hidden = view !== 'afterpage';
      el('log-view').hidden = view !== 'log';
      el('commonplace-view').hidden = view !== 'commonplace';
    };
  }
}

renderAfterpage();
renderHeatmap();
renderFinished();
renderCommonplace();
wireViews();
