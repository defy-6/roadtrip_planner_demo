// Place-editor form structure only; queries, selection and persistence stay in editor.
export function createPlaceEditorSections(dialog) {
  const documentRef = dialog.ownerDocument;
  const find = selector => dialog.querySelector(selector);
  const photoFile = find('#newPlacePhoto');
  const photoFileLabel = photoFile.closest('label');
  const photoSection = documentRef.createElement('details');
  photoSection.className = 'editor-section place-photo-section';
  photoSection.innerHTML = '<summary><span>地点图片</span><small data-place-photo-summary>可选 · 相册或高德图片</small></summary><div class="place-photo-section-content"></div>';
  photoFileLabel.before(photoSection);
  const photoContent = photoSection.querySelector('.place-photo-section-content');
  photoContent.append(find('#newPlaceCurrentPhoto'), find('#newPlacePhotoCandidates'), photoFileLabel);
  photoFileLabel.classList.add('place-photo-upload');
  photoFileLabel.firstChild.textContent = '';
  photoFile.classList.add('place-photo-input');
  const photoUploadButton = documentRef.createElement('span');
  photoUploadButton.className = 'place-photo-upload-button';
  photoUploadButton.textContent = '选择本地图片';
  const photoUploadName = documentRef.createElement('small');
  photoUploadName.className = 'place-photo-upload-name';
  photoUploadName.textContent = '未选择图片';
  photoFile.after(photoUploadButton, photoUploadName);
  photoFile.onchange = () => { photoUploadName.textContent = photoFile.files[0]?.name || '未选择图片'; };

  const detailFields = find('.place-detail-fields');
  const detailsSection = documentRef.createElement('details');
  detailsSection.className = 'editor-section place-details-section';
  detailsSection.innerHTML = '<summary><span>POI 详情与备注</span><small data-place-details-summary>选填</small></summary><div class="place-details-section-content"></div>';
  detailFields.before(detailsSection);
  detailsSection.querySelector('.place-details-section-content').append(detailFields);
  detailFields.querySelector('legend').hidden = true;
  const associations = documentRef.createElement('section');
  associations.className = 'place-event-associations';
  associations.hidden = true;
  find('#newPlaceAmapStatus').insertAdjacentElement('afterend', associations);
  const candidatesPanel = documentRef.createElement('section');
  candidatesPanel.className = 'place-query-candidates';
  candidatesPanel.hidden = true;
  find('#newPlaceAmapStatus').insertAdjacentElement('afterend', candidatesPanel);
  return { photoSection, photoUploadName, detailsSection, associations, candidatesPanel };
}
