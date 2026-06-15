import httpx
from fastapi.testclient import TestClient

from app.core.settings import settings
from app.main import app


client = TestClient(app)


def _httpx_response(method: str, url: str, *, json=None, status_code: int = 200) -> httpx.Response:
    request = httpx.Request(method, url)
    return httpx.Response(status_code=status_code, json=json, request=request)


def test_delete_series_deletes_matching_orthanc_series(monkeypatch):
    original_orthanc_base_url = settings.orthanc_base_url
    original_dicomweb_headers = settings.dicomweb_headers

    object.__setattr__(settings, 'orthanc_base_url', 'http://orthanc.local')
    object.__setattr__(settings, 'dicomweb_headers', {'Authorization': 'Bearer test-token'})

    calls: list[tuple[str, str, dict | None]] = []

    def fake_post(url: str, **kwargs):
        calls.append(('POST', url, kwargs.get('json')))
        return _httpx_response('POST', url, json=['orthanc-series-id-1'])

    def fake_get(url: str, **kwargs):
        calls.append(('GET', url, None))
        assert kwargs['headers']['Authorization'] == 'Bearer test-token'
        return _httpx_response(
            'GET',
            url,
            json={'MainDicomTags': {'SeriesDescription': 'AI | monai 20260615-101500 SEG'}},
        )

    def fake_delete(url: str, **kwargs):
        calls.append(('DELETE', url, None))
        assert kwargs['headers']['Authorization'] == 'Bearer test-token'
        return _httpx_response('DELETE', url)

    monkeypatch.setattr('app.services.series_delete.httpx.post', fake_post)
    monkeypatch.setattr('app.services.series_delete.httpx.get', fake_get)
    monkeypatch.setattr('app.services.series_delete.httpx.delete', fake_delete)

    response = client.delete('/series/1.2.840.113619.2.55.3.604688433.1234.5678')

    assert response.status_code == 200
    assert response.json() == {
        'seriesInstanceUID': '1.2.840.113619.2.55.3.604688433.1234.5678',
        'orthancSeriesIds': ['orthanc-series-id-1'],
        'deletedSeriesCount': 1,
    }
    assert calls == [
        (
            'POST',
            'http://orthanc.local/tools/find',
            {
                'Level': 'Series',
                'Query': {
                    'SeriesInstanceUID': '1.2.840.113619.2.55.3.604688433.1234.5678',
                },
            },
        ),
        ('GET', 'http://orthanc.local/series/orthanc-series-id-1', None),
        ('DELETE', 'http://orthanc.local/series/orthanc-series-id-1', None),
    ]

    object.__setattr__(settings, 'orthanc_base_url', original_orthanc_base_url)
    object.__setattr__(settings, 'dicomweb_headers', original_dicomweb_headers)


def test_delete_series_returns_not_found_when_orthanc_has_no_match(monkeypatch):
    original_orthanc_base_url = settings.orthanc_base_url
    object.__setattr__(settings, 'orthanc_base_url', 'http://orthanc.local')

    def fake_post(url: str, **_kwargs):
        return _httpx_response('POST', url, json=[])

    monkeypatch.setattr('app.services.series_delete.httpx.post', fake_post)

    response = client.delete('/series/9.9.9')

    assert response.status_code == 404
    assert 'Orthanc could not find series 9.9.9' in response.json()['detail']

    object.__setattr__(settings, 'orthanc_base_url', original_orthanc_base_url)


def test_delete_series_rejects_non_ai_result_series(monkeypatch):
    original_orthanc_base_url = settings.orthanc_base_url
    object.__setattr__(settings, 'orthanc_base_url', 'http://orthanc.local')

    def fake_post(url: str, **_kwargs):
        return _httpx_response('POST', url, json=['orthanc-series-id-2'])

    def fake_get(url: str, **_kwargs):
        return _httpx_response(
            'GET',
            url,
            json={'MainDicomTags': {'SeriesDescription': 'Abdomen CT Venous Phase'}},
        )

    monkeypatch.setattr('app.services.series_delete.httpx.post', fake_post)
    monkeypatch.setattr('app.services.series_delete.httpx.get', fake_get)

    response = client.delete('/series/8.8.8')

    assert response.status_code == 403
    assert 'is not an AI result' in response.json()['detail']

    object.__setattr__(settings, 'orthanc_base_url', original_orthanc_base_url)
