const hiddenLegacyTypes = new Set(['service', 'fuel', 'flight']);

export function configureRuntimeEventInputs({ $, template, eventTypeNames, OptionCtor = Option }) {
  const editorType = $('#editorType');
  const itemType = $('.type', template.content);
  const additions = [
    ['路程', 'drive'],
    ['航班', 'flight'],
    ['交通 / 手续', 'transport']
  ];
  additions.forEach(([label, value]) => {
    editorType.append(new OptionCtor(label, value));
    itemType.append(new OptionCtor(label, value));
  });

  [editorType, itemType].forEach(select => {
    select.querySelectorAll('option').forEach(option => {
      option.textContent = eventTypeNames[option.value] || option.textContent;
      option.hidden = hiddenLegacyTypes.has(option.value);
    });
  });

  const addressPlaceholder = '具体地址待定可留空，填写后可定位';
  $('.address', template.content).placeholder = addressPlaceholder;
  $('#editorAddress').placeholder = addressPlaceholder;

  return node => ({
    type: $('.type', node).value,
    date: $('.date', node).value,
    startTime: $('.start-time', node).value,
    endTime: $('.end-time', node).value,
    name: $('.name', node).value,
    address: $('.address', node).value,
    note: $('.note', node).value,
    photo: $('.preview', node).hidden ? '' : $('.preview', node).src,
    scheduleIndex: Number(node.dataset.scheduleIndex)
  });
}
