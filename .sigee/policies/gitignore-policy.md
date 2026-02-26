# .sigee Gitignore Policy

## 목적
- `.sigee` 내 로컬/생성 산출물이 저장소에 유입되는 것을 방지합니다.
- 거버넌스 문서(정책, product-truth)는 추적 가능하도록 allow-list로 관리합니다.

## 기본 규칙
- deny-by-default: `.sigee/*`
- allow-list: `.sigee/README.md`, `.sigee/policies/**`, `.sigee/product-truth/**`
- runtime/임시 산출물은 항상 ignore: `.sigee/.runtime/`, `.sigee/tmp/`, `.sigee/reports/`, `.sigee/evidence/`
