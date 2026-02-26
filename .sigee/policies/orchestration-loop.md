# Orchestration Loop Policy

## 큐
- planner-inbox
- scientist-todo
- developer-todo
- planner-review
- blocked
- done

## 라우팅
- planner-inbox -> (scientist-todo | developer-todo)
- scientist/developer 완료 -> planner-review
- planner-review 승인 -> done
- 외부 결정 필요 -> blocked

## Done 게이트
- `planner-review -> done` 전이만 허용합니다.
- evidence 링크와 PASS 검증 근거가 필요합니다.
