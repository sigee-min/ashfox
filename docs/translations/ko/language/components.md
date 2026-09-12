# 컴포넌트와 소켓

component는 명시적 매개변수·타입 포트와 함께 모델 형상을 묶습니다. 조립에서 `use`로 인스턴스화합니다. 계약은 명목적이므로 필드가 같아도 선언 식별자가 다르면 교환할 수 없습니다. rig·surface는 [완전한 모델](model.md#complete-source)에서 시작하세요.

## 매개변수

component 안에 `param name: type;`을 선언합니다. 기본값이 없으므로 각 인스턴스가 선언한 값을 `set`으로 정확히 한 번씩 제공해야 합니다. 문자열 기반 레코드 대신 [닫힌 값 타입](values.md#closed-value-types)을 쓰세요.

완전한 모델의 `Body`를 교체하는 조각입니다.

{{source-code:0}}

`export asset sample`의 인스턴스입니다.

{{source-code:1}}

매개변수는 `size`처럼 로컬 이름, design은 `Dimensions.size`처럼 정규 이름을 씁니다. 형상 매개변수를 바꿔도 surface contract 크기가 자동으로 바뀌지는 않으므로 공용 design도 갱신·매개변수화하세요. 알 수 없는·중복·누락·타입 불일치 값은 실패합니다.

## 포트와 바인딩

| 선언·바인딩 | 의미 |
| --- | --- |
| `requires rig skeleton: Rig;` | 선택한 skeleton의 rig contract와 같아야 하는 rig 포트 |
| `requires surface skin: Skin;` | 정확한 surface contract를 요구 |
| `requires socket mount: Mount;` | 들어오는 연결 하나가 필요한 부착점 |
| `provides socket hand: Mount capacity = one;` | 연결 하나를 허용하는 제공자. `many`는 여러 개 |
| `bind bone root to skeleton.root;` | rig 포트를 통해 형상 본을 관절에 연결 |
| `bind socket mount to bone anchor { frame { … } }` | 명시적 로컬 프레임으로 소켓을 형상 본에 연결 |
| 인스턴스 `bind skeleton = Rig;` | 조립 skeleton과 일치하는 포트의 rig contract 선택 |
| 인스턴스 `bind skin = concrete_surface;` | 요구 계약을 구현한 구체 표면 제공 |
| `connect body.hand -> shield.mount;` | 제공 endpoint와 요구 endpoint 연결 |

조립의 `skeleton = ConcreteSkeleton;`은 구현을 선택합니다. `use`의 rig 바인딩은 skeleton이 아닌 **rig contract** 이름입니다. socket 포트는 `bind port = …`가 아닌 `connect`로 충족합니다. connect에는 socket 제공자만 참여하며 제공 포트는 조립 bind를 받지 않습니다. rig·surface 의존성은 required 포트를 쓰세요.

## 소켓 계약과 프레임

모델 단위 안의 조각입니다.

{{source-code:2}}

프레임은 부호 있는 직교 축 셋입니다. 계약은 방향·손잡이성 `right|left`를 선언하고 구체 endpoint는 원점도 제공합니다. endpoint의 문구가 계약과 같을 필요는 없지만 손잡이성은 일치해야 합니다.

형상 본 `anchor`가 있는 component 안의 조각입니다.

{{source-code:3}}

제공자는 `provides socket hand: Mount capacity = one;`을 선언하고 같은 endpoint 문법으로 hand를 본에 연결합니다. rig도 자체 관절의 소켓을 선언할 수 있습니다.

{{source-code:4}}

## 배치와 검증

rig에 연결된 형상은 선택한 skeleton을 따릅니다. 직접 바인딩한 본에 충돌하는 position·rotation·pivot을 추가하지 마세요. socket 소유 component는 연결로 배치하며 선언 endpoint가 제공자와 맞출 로컬 점을 정합니다. 가까운 형상이 암묵적 바인딩이 되지 않습니다.

요구 socket마다 제공자 하나가 정확히 필요하고 제공자는 one·many 용량을 지킵니다. 계약 불일치·endpoint 누락·복수 부착 권한·연결 순환은 실패합니다. 방향은 `provider.port -> required.port`입니다.

skeleton의 `parent-origin`은 부모 관절 프레임이며 형상·socket frame의 `origin`은 각 로컬 공간입니다. 오프셋 작성 전 [리그와 스켈레톤](model.md#4-rigs-and-skeletons)을 읽고 부착점 변경 후 정지 포즈와 모든 동작을 확인하세요.
