# Authority Evidence

The product maps only to the `ZJU-IDI-2027` evidence set:

| ID | Role | Public URL | Hash handling |
|---|---|---|---|
| `zju-2027-notice` | 2027 admission notice | <https://www.idi.zju.edu.cn/5060.html> | Verify on successful live fetch |
| `zju-337-2027` | 337 syllabus PDF | <https://www.idi.zju.edu.cn/wp-content/uploads/2026/06/f952ddc1036c1ac9e9943c67dad6d09b-1.pdf> | Verify PDF MIME/signature and hash on fetch |
| `zju-902-2027` | 902 syllabus PDF | <https://www.idi.zju.edu.cn/wp-content/uploads/2026/06/5a10a6eff6ff5a5216ab38c7b6cd3253-2.pdf> | Verify PDF MIME/signature and hash on fetch |

During the initial clean-room replay, the local host could not establish the site's TLS certificate chain. The repository therefore records `contentSha256: null` with `hashStatus: verify_on_fetch` instead of inventing a PDF hash. A later successful live fetch may add the measured hash to cache provenance; it must not silently rewrite this evidence registry.
