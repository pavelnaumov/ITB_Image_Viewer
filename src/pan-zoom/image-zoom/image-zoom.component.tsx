import * as React from 'react';
import {
  Animated,
  LayoutChangeEvent,
  PanResponder,
  PanResponderInstance,
  Platform,
  PlatformOSType,
  StyleSheet,
  View,
  Alert,
} from 'react-native';
import styles from './image-zoom.style';
import { ICenterOn, Props, State } from './image-zoom.type';

export default class ImageViewer extends React.Component<Props, State> {
  public static defaultProps = new Props();
  public state = new State(); // last / current / animation x displacement

  private lastPositionX: number | null = null;
  private positionX = 0;
  private animatedPositionX = new Animated.Value(0); // last / current / animated y displacement

  private lastPositionY: number | null = null;
  private positionY = 0;
  private animatedPositionY = new Animated.Value(0); // zoom size

  private scale = 1;
  private animatedScale = new Animated.Value(1);
  private zoomLastDistance: number | null = null;
  private zoomCurrentDistance = 0; // Picture gesture processing

  private imagePanResponder: PanResponderInstance | null = null; // Last time the hand was pressed

  private lastTouchStartTime: number = 0; // The overall horizontal cross-boundary offset during sliding

  private horizontalWholeOuterCounter = 0; // swipeDown offset during sliding

  private swipeDownOffset = 0;

  private swipeUpOffset = 0; // total displacement of x y during sliding

  private horizontalWholeCounter = 0;
  private verticalWholeCounter = 0; // Position of both hands from the center point

  private centerDiffX = 0;
  private centerDiffY = 0; // timeout to trigger the click

  private singleClickTimeout: any; // Calculate long timeout

  private longPressTimeout: any; // time of the last click

  private lastClickTime = 0; // position when double-clicked

  private doubleClickX = 0;
  private doubleClickY = 0; // whether double-clicked

  private isDoubleClick = false; // Is it long press

  private isLongPress = false; // whether to slide left and right

  private isHorizontalWrap = false;

  public componentWillMount() {
    this.imagePanResponder = PanResponder.create({
      // Request to become a responder:
      onStartShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,

      onPanResponderGrant: evt => {
        // start gesture operation
        this.lastPositionX = null;
        this.lastPositionY = null;
        this.zoomLastDistance = null;
        this.horizontalWholeCounter = 0;
        this.verticalWholeCounter = 0;
        this.lastTouchStartTime = new Date().getTime();
        this.isDoubleClick = false;
        this.isLongPress = false;
        this.isHorizontalWrap = false; // Clear the click timer when any gesture starts

        if (this.singleClickTimeout) {
          clearTimeout(this.singleClickTimeout);
        }

        if (evt.nativeEvent.changedTouches.length > 1) {
          const centerX = (evt.nativeEvent.changedTouches[0].pageX + evt.nativeEvent.changedTouches[1].pageX) / 2;
          this.centerDiffX = centerX - this.props.cropWidth / 2;

          const centerY = (evt.nativeEvent.changedTouches[0].pageY + evt.nativeEvent.changedTouches[1].pageY) / 2;
          this.centerDiffY = centerY - this.props.cropHeight / 2;
        } // calculate long press

        if (this.longPressTimeout) {
          clearTimeout(this.longPressTimeout);
        }
        this.longPressTimeout = setTimeout(() => {
          this.isLongPress = true;
          if (this.props.onLongPress) {
            this.props.onLongPress();
          }
        }, this.props.longPressTime);

        if (evt.nativeEvent.changedTouches.length <= 1) {
          // one finger case
          if (new Date().getTime() - this.lastClickTime < (this.props.doubleClickInterval || 0)) {
            // thinks a double click is triggered
            this.lastClickTime = 0;
            if (this.props.onDoubleClick) {
              this.props.onDoubleClick();
            } // cancel long press

            clearTimeout(this.longPressTimeout); // Record the coordinate position when double-clicking because zoom may be triggered

            this.doubleClickX = evt.nativeEvent.changedTouches[0].pageX;
            this.doubleClickY = evt.nativeEvent.changedTouches[0].pageY; // zoom

            this.isDoubleClick = true;

            if (this.props.enableDoubleClickZoom) {
              if (this.scale > 1 || this.scale < 1) {
                // return to original position
                this.scale = 1;

                this.positionX = 0;
                this.positionY = 0;
              } else {
                // start zooming at displacement
                // zoom ratio before recording
                // this.scale must be 1 at this time
                const beforeScale = this.scale; // start zooming

                this.scale = 2; // scale diff

                const diffScale = this.scale - beforeScale; // Find the displacement of the center point of the two hands from the center of the page // moving position
                this.positionX = ((this.props.cropWidth / 2 - this.doubleClickX) * diffScale) / this.scale;

                this.positionY = ((this.props.cropHeight / 2 - this.doubleClickY) * diffScale) / this.scale;
              }

              this.imageDidMove('centerOn');

              Animated.parallel([
                Animated.timing(this.animatedScale, {
                  toValue: this.scale,
                  duration: 100,
                }),
                Animated.timing(this.animatedPositionX, {
                  toValue: this.positionX,
                  duration: 100,
                }),
                Animated.timing(this.animatedPositionY, {
                  toValue: this.positionY,
                  duration: 100,
                }),
              ]).start();
            }
          } else {
            this.lastClickTime = new Date().getTime();
          }
        }
      },
      onPanResponderMove: (evt, gestureState) => {
        if (this.isDoubleClick) {
          // 有时双击会被当做位移，这里屏蔽掉
          // Sometimes double-clicking will be used as displacement, which is masked here
          return;
        }

        if (evt.nativeEvent.changedTouches.length <= 1) {
          // x 位移
          // x displacement
          let diffX = gestureState.dx - (this.lastPositionX || 0);

          if (this.lastPositionX === null) {
            diffX = 0;
          }
          // y 位移
          let diffY = gestureState.dy - (this.lastPositionY || 0);
          if (this.lastPositionY === null) {
            diffY = 0;
          }

          // 保留这一次位移作为下次的上一次位移
          // Keep this displacement as the next previous displacement
          this.lastPositionX = gestureState.dx;
          this.lastPositionY = gestureState.dy;

          this.horizontalWholeCounter += diffX;
          this.verticalWholeCounter += diffY;

          if (Math.abs(this.horizontalWholeCounter) > 5 || Math.abs(this.verticalWholeCounter) > 5) {
            // 如果位移超出手指范围，取消长按监听
            clearTimeout(this.longPressTimeout);
          }

          if (this.props.panToMove) {
            // Handle swipes left and right if swipeDown is in progress
            if (this.swipeDownOffset === 0) {
              if (Math.abs(diffX) > Math.abs(diffY)) {
                this.isHorizontalWrap = true;
              }

              // diffX > 0 表示手往右滑，图往左移动，反之同理
              // diffX> 0 means the hand slides to the right, the picture moves to the left, and vice versa
              // horizontalWholeOuterCounter > 0 表示溢出在左侧，反之在右侧，绝对值越大溢出越多
              if (this.props.imageWidth * this.scale > this.props.cropWidth) {
                // 如果图片宽度大图盒子宽度， 可以横向拖拽
                // If the image width is larger than the box width, you can drag horizontally
                // 没有溢出偏移量或者这次位移完全收回了偏移量才能拖拽
                if (this.horizontalWholeOuterCounter > 0) {
                  // 溢出在右侧
                  // overflow on the right
                  if (diffX < 0) {
                    // 从右侧收紧
                    // tighten from right
                    if (this.horizontalWholeOuterCounter > Math.abs(diffX)) {
                      // 偏移量还没有用完
                      // the offset has not been used up yet
                      this.horizontalWholeOuterCounter += diffX;
                      diffX = 0;
                    } else {
                      // 溢出量置为0，偏移量减去剩余溢出量，并且可以被拖动
                      // The overflow is set to 0, the offset is subtracted from the remaining overflow, and it can be dragged
                      diffX += this.horizontalWholeOuterCounter;
                      this.horizontalWholeOuterCounter = 0;
                      if (this.props.horizontalOuterRangeOffset) {
                        this.props.horizontalOuterRangeOffset(0);
                      }
                    }
                  } else {
                    // 向右侧扩增
                    // expand to the right
                    this.horizontalWholeOuterCounter += diffX;
                  }
                } else if (this.horizontalWholeOuterCounter < 0) {
                  // 溢出在左侧
                  // overflow on the left
                  if (diffX > 0) {
                    // 从左侧收紧
                    if (Math.abs(this.horizontalWholeOuterCounter) > diffX) {
                      // 偏移量还没有用完
                      // the offset has not been used up yet
                      this.horizontalWholeOuterCounter += diffX;
                      diffX = 0;
                    } else {
                      // 溢出量置为0，偏移量减去剩余溢出量，并且可以被拖动
                      // The overflow is set to 0, the offset is subtracted from the remaining overflow, and it can be dragged
                      diffX += this.horizontalWholeOuterCounter;
                      this.horizontalWholeOuterCounter = 0;
                      if (this.props.horizontalOuterRangeOffset) {
                        this.props.horizontalOuterRangeOffset(0);
                      }
                    }
                  } else {
                    // 向左侧扩增
                    // expand to the left
                    this.horizontalWholeOuterCounter += diffX;
                  }
                } else {
                  // 溢出偏移量为0，正常移动
                  // overflow offset is 0, normal movement
                }

                // 产生位移
                // generate displacement
                this.positionX += diffX / this.scale;

                // 但是横向不能出现黑边
                // but no black edges appear in the horizontal direction
                // 横向能容忍的绝对值
                const horizontalMax = (this.props.imageWidth * this.scale - this.props.cropWidth) / 2 / this.scale;
                if (this.positionX < -horizontalMax) {
                  // 超越了左边临界点，还在继续向左移动
                  // Exceeded the left critical point and continued to move left
                  this.positionX = -horizontalMax;

                  // 让其产生细微位移，偏离轨道
                  // Let it move slightly and deviate from orbit
                  this.horizontalWholeOuterCounter += -1 / 1e10;
                } else if (this.positionX > horizontalMax) {
                  // 超越了右侧临界点，还在继续向右移动
                  // Exceeded the right critical point and continued to move to the right
                  this.positionX = horizontalMax;

                  // 让其产生细微位移，偏离轨道
                  // Let it move slightly and deviate from orbit
                  this.horizontalWholeOuterCounter += 1 / 1e10;
                }
                this.animatedPositionX.setValue(this.positionX);
              } else {
                // 不能横向拖拽，全部算做溢出偏移量
                // Can't drag horizontally, all count as overflow offset
                this.horizontalWholeOuterCounter += diffX;
              }

              // 溢出量不会超过设定界限
              // the overflow will not exceed the set limit
              if (this.horizontalWholeOuterCounter > (this.props.maxOverflow || 0)) {
                this.horizontalWholeOuterCounter = this.props.maxOverflow || 0;
              } else if (this.horizontalWholeOuterCounter < -(this.props.maxOverflow || 0)) {
                this.horizontalWholeOuterCounter = -(this.props.maxOverflow || 0);
              }

              if (this.horizontalWholeOuterCounter !== 0) {
                // 如果溢出偏移量不是0，执行溢出回调
                // If the overflow offset is not 0, execute the overflow callback
                if (this.props.horizontalOuterRangeOffset) {
                  this.props.horizontalOuterRangeOffset(this.horizontalWholeOuterCounter);
                }
              }
            }

            // 如果图片高度大于盒子高度， 可以纵向弹性拖拽
            // If the picture height is greater than the box height, you can drag vertically and flexibly
            if (this.props.imageHeight * this.scale > this.props.cropHeight) {
              this.positionY += diffY / this.scale;
              this.animatedPositionY.setValue(this.positionY);

              // If the top edge of the picture is off the top edge of the screen, enter the swipeDown action
              // if (
              //   (this.props.imageHeight / 2 - this.positionY) * this.scale <
              //   this.props.cropHeight / 2
              // ) {
              //   if (this.props.enableSwipeDown) {
              //     this.swipeDownOffset += diffY

              //     // 只要滑动溢出量不小于 0，就可以拖动
              //     if (this.swipeDownOffset > 0) {
              //       this.positionY += diffY / this.scale
              //       this.animatedPositionY.setValue(this.positionY)

              //       // 越到下方，缩放越小
              //       this.scale = this.scale - diffY / 1000
              //       this.animatedScale.setValue(this.scale)
              //     }
              //   }
              // }
            } else {
              // swipeDown 不允许在已经有横向偏移量时触发
              // swipeDown is not allowed to trigger when there is already a horizontal offset
              if (this.props.enableSwipeDown && !this.isHorizontalWrap) {
                // 图片高度小于盒子高度，只能向下拖拽，而且一定是 swipeDown 动作
                // The height of the picture is less than the height of the box, it can only be dragged down, and it must be a swipeDown action
                this.swipeDownOffset += diffY;

                // 只要滑动溢出量不小于 0，就可以拖动
                // as long as the sliding overflow is not less than 0, you can drag
                if (this.swipeDownOffset > 0) {
                  this.positionY += diffY / this.scale;
                  this.animatedPositionY.setValue(this.positionY);

                  // 越到下方，缩放越小
                  this.scale = this.scale - diffY / 1000;
                  this.animatedScale.setValue(this.scale);
                }
                if (this.swipeUpOffset > 0) {
                  this.positionY += diffY / this.scale;
                  this.animatedPositionY.setValue(this.positionY);
                }
              }

              // enable swipeUp TODO: HERE
              if (this.props.enableSwipeUp && !this.isHorizontalWrap) {
                this.swipeDownOffset += diffX; // HERE: ALLOWS TO DRAG upwards

                if (this.swipeDownOffset < 0) {
                  this.positionY += diffY / this.scale;
                  this.animatedPositionY.setValue(this.positionY);

                  this.scale = this.scale - diffY / 1000;
                  this.animatedScale.setValue(this.scale);
                }
                if (this.swipeDownOffset < 0) {
                  this.scale = this.scale - diffY / 1000;
                  this.positionY += diffY / this.scale;
                  this.animatedPositionY.setValue(this.positionY);
                }
              }
            }
          }
        } else {
          // 多个手指的情况
          // with multiple fingers
          // 取消长按状态
          if (this.longPressTimeout) {
            clearTimeout(this.longPressTimeout);
          }

          if (this.props.pinchToZoom) {
            // 找最小的 x 和最大的 x
            // find the smallest x and the largest x
            let minX: number;
            let maxX: number;
            if (evt.nativeEvent.changedTouches[0].locationX > evt.nativeEvent.changedTouches[1].locationX) {
              minX = evt.nativeEvent.changedTouches[1].pageX;
              maxX = evt.nativeEvent.changedTouches[0].pageX;
            } else {
              minX = evt.nativeEvent.changedTouches[0].pageX;
              maxX = evt.nativeEvent.changedTouches[1].pageX;
            }

            let minY: number;
            let maxY: number;
            if (evt.nativeEvent.changedTouches[0].locationY > evt.nativeEvent.changedTouches[1].locationY) {
              minY = evt.nativeEvent.changedTouches[1].pageY;
              maxY = evt.nativeEvent.changedTouches[0].pageY;
            } else {
              minY = evt.nativeEvent.changedTouches[0].pageY;
              maxY = evt.nativeEvent.changedTouches[1].pageY;
            }

            const widthDistance = maxX - minX;
            const heightDistance = maxY - minY;
            const diagonalDistance = Math.sqrt(widthDistance * widthDistance + heightDistance * heightDistance);
            this.zoomCurrentDistance = Number(diagonalDistance.toFixed(1));

            if (this.zoomLastDistance !== null) {
              const distanceDiff = (this.zoomCurrentDistance - this.zoomLastDistance) / 200;
              let zoom = this.scale + distanceDiff;

              if (zoom < (this!.props!.minScale || 0)) {
                zoom = this!.props!.minScale || 0;
              }
              if (zoom > (this!.props!.maxScale || 0)) {
                zoom = this!.props!.maxScale || 0;
              }

              // 记录之前缩放比例
              // zoom ratio before recording
              const beforeScale = this.scale;

              // 开始缩放
              // start zooming
              this.scale = zoom;
              this.animatedScale.setValue(this.scale);

              // 图片要慢慢往两个手指的中心点移动
              // The picture should slowly move to the center point of the two fingers
              // 缩放 diff
              const diffScale = this.scale - beforeScale;
              // 找到两手中心点距离页面中心的位移
              // Find the displacement of the center point of the two hands from the center of the page
              // 移动位置
              this.positionX -= (this.centerDiffX * diffScale) / this.scale;
              this.positionY -= (this.centerDiffY * diffScale) / this.scale;
              this.animatedPositionX.setValue(this.positionX);
              this.animatedPositionY.setValue(this.positionY);
            }
            this.zoomLastDistance = this.zoomCurrentDistance;
          }
        }

        this.imageDidMove('onPanResponderMove');
      },
      onPanResponderRelease: (evt, gestureState) => {
        // 取消长按
        // cancel long press
        if (this.longPressTimeout) {
          clearTimeout(this.longPressTimeout);
        }

        // 双击结束，结束尾判断
        // Double-click to end, end the end judgment
        if (this.isDoubleClick) {
          return;
        }

        // 长按结束，结束尾判断
        // Press and hold to end, judge at the end
        if (this.isLongPress) {
          return;
        }

        // 如果是单个手指、距离上次按住大于预设秒、滑动距离小于预设值, 则可能是单击（如果后续双击间隔内没有开始手势）
        // If it is a single finger, the distance from the last press is greater than the preset second, and the sliding distance is less than the preset value, it may be a click (if there is no start gesture in the subsequent double-click interval)
        // const stayTime = new Date().getTime() - this.lastTouchStartTime!
        const moveDistance = Math.sqrt(gestureState.dx * gestureState.dx + gestureState.dy * gestureState.dy);
        const { locationX, locationY, pageX, pageY } = evt.nativeEvent;

        if (evt.nativeEvent.changedTouches.length === 1 && moveDistance < (this.props.clickDistance || 0)) {
          this.singleClickTimeout = setTimeout(() => {
            if (this.props.onClick) {
              this.props.onClick({ locationX, locationY, pageX, pageY });
            }
          }, this.props.doubleClickInterval);
        } else {
          // 多手势结束，或者滑动结束
          // End with multiple gestures or end with swipe
          if (this.props.responderRelease) {
            this.props.responderRelease(gestureState.vx, this.scale);
          }

          this.panResponderReleaseResolve();
        }
      },
      onPanResponderTerminate: () => {
        //
      },
    });
  }

  public resetScale = () => {
    this.positionX = 0;
    this.positionY = 0;
    this.scale = 1;
    this.animatedScale.setValue(1);
  };

  public panResponderReleaseResolve = () => {
    // 判断是否是 swipeDown
    // determine if it is swipeDown
    if (this.props.enableSwipeDown && this.props.swipeDownThreshold) {
      if (this.swipeDownOffset > this.props.swipeDownThreshold) {
        if (this.props.onSwipeDown) {
          this.props.onSwipeDown();
        }
        // Stop reset.
        return;
      }
    }

    // swipeUp

    if (this.props.enableSwipeUp && this.props.swipeDownThreshold) {
      if (this.swipeDownOffset < -200) {
        if (this.props.onSwipeUp) {
          this.props.onSwipeUp();
        }
        // Stop reset.
        return;
      }
    }

    if (this.props.enableCenterFocus && this.scale < 1) {
      // 如果缩放小于1，强制重置为 1
      // If the scale is less than 1, force reset to 1
      this.scale = 1;
      Animated.timing(this.animatedScale, {
        toValue: this.scale,
        duration: 100,
      }).start();
    }

    if (this.props.imageWidth * this.scale <= this.props.cropWidth) {
      // 如果图片宽度小于盒子宽度，横向位置重置
      // If the image width is smaller than the box width, the horizontal position is reset
      this.positionX = 0;
      Animated.timing(this.animatedPositionX, {
        toValue: this.positionX,
        duration: 100,
      }).start();
    }

    if (this.props.imageHeight * this.scale <= this.props.cropHeight) {
      // 如果图片高度小于盒子高度，纵向位置重置
      // If the image height is less than the box height, the vertical position is reset
      this.positionY = 0;
      Animated.timing(this.animatedPositionY, {
        toValue: this.positionY,
        duration: 100,
      }).start();
    }

    // 横向肯定不会超出范围，由拖拽时控制
    // The horizontal direction will definitely not exceed the range, which is controlled by dragging
    // 如果图片高度大于盒子高度，纵向不能出现黑边
    if (this.props.imageHeight * this.scale > this.props.cropHeight) {
      // 纵向能容忍的绝对值
      // vertical tolerable absolute value
      const verticalMax = (this.props.imageHeight * this.scale - this.props.cropHeight) / 2 / this.scale;
      if (this.positionY < -verticalMax) {
        this.positionY = -verticalMax;
      } else if (this.positionY > verticalMax) {
        this.positionY = verticalMax;
      }
      Animated.timing(this.animatedPositionY, {
        toValue: this.positionY,
        duration: 100,
      }).start();
    }

    if (this.props.imageWidth * this.scale > this.props.cropWidth) {
      // 纵向能容忍的绝对值
      // vertical tolerable absolute value
      const horizontalMax = (this.props.imageWidth * this.scale - this.props.cropWidth) / 2 / this.scale;
      if (this.positionX < -horizontalMax) {
        this.positionX = -horizontalMax;
      } else if (this.positionX > horizontalMax) {
        this.positionX = horizontalMax;
      }
      Animated.timing(this.animatedPositionX, {
        toValue: this.positionX,
        duration: 100,
      }).start();
    }

    // 拖拽正常结束后,如果没有缩放,直接回到0,0点
    // After the dragging ends normally, if there is no zoom, return directly to 0,0 points
    if (this.props.enableCenterFocus && this.scale === 1) {
      this.positionX = 0;
      this.positionY = 0;
      Animated.timing(this.animatedPositionX, {
        toValue: this.positionX,
        duration: 100,
      }).start();
      Animated.timing(this.animatedPositionY, {
        toValue: this.positionY,
        duration: 100,
      }).start();
    }

    // 水平溢出量置空
    // horizontal overflow is blank
    this.horizontalWholeOuterCounter = 0;

    // swipeDown 溢出量置空
    // swipeDown overflow is empty
    this.swipeDownOffset = 0;

    this.swipeUpOffset = 0;

    this.imageDidMove('onPanResponderRelease');
  };

  public componentDidMount() {
    if (this.props.centerOn) {
      this.centerOn(this.props.centerOn);
    }
  }

  public componentWillReceiveProps(nextProps: Props) {
    // Either centerOn has never been called, or it is a repeat and we should ignore it
    if (
      (nextProps.centerOn && !this.props.centerOn) ||
      (nextProps.centerOn && this.props.centerOn && this.didCenterOnChange(this.props.centerOn, nextProps.centerOn))
    ) {
      this.centerOn(nextProps.centerOn);
    }
  }

  public imageDidMove(type: string) {
    if (this.props.onMove) {
      this.props.onMove({
        type,
        positionX: this.positionX,
        positionY: this.positionY,
        scale: this.scale,
        zoomCurrentDistance: this.zoomCurrentDistance,
      });
    }
  }

  public didCenterOnChange(
    params: { x: number; y: number; scale: number; duration: number },
    paramsNext: { x: number; y: number; scale: number; duration: number },
  ) {
    return params.x !== paramsNext.x || params.y !== paramsNext.y || params.scale !== paramsNext.scale;
  }

  public centerOn(params: ICenterOn) {
    this.positionX = params!.x;
    this.positionY = params!.y;
    this.scale = params!.scale;
    const duration = params!.duration || 300;
    Animated.parallel([
      Animated.timing(this.animatedScale, {
        toValue: this.scale,
        duration,
      }),
      Animated.timing(this.animatedPositionX, {
        toValue: this.positionX,
        duration,
      }),
      Animated.timing(this.animatedPositionY, {
        toValue: this.positionY,
        duration,
      }),
    ]).start(() => {
      this.imageDidMove('centerOn');
    });
  }

  /**
   * 图片区域视图渲染完毕
   * The picture area view is rendered
   */
  public handleLayout(event: LayoutChangeEvent) {
    if (this.props.layoutChange) {
      this.props.layoutChange(event);
    }
  }

  /**
   * 重置大小和位置
   * Reset size and position
   */
  public reset() {
    this.scale = 1;
    this.animatedScale.setValue(this.scale);
    this.positionX = 0;
    this.animatedPositionX.setValue(this.positionX);
    this.positionY = 0;
    this.animatedPositionY.setValue(this.positionY);
  }

  public render() {
    const animateConf = {
      transform: [
        {
          scale: this.animatedScale,
        },
        {
          translateX: this.animatedPositionX,
        },
        {
          translateY: this.animatedPositionY,
        },
      ],
    };

    const parentStyles = StyleSheet.flatten(this.props.style);

    return (
      <View
        style={{
          ...styles.container,
          ...parentStyles,
          width: this.props.cropWidth,
          height: this.props.cropHeight,
        }}
        {...this.imagePanResponder!.panHandlers}
      >
        <Animated.View style={animateConf} renderToHardwareTextureAndroid>
          <View
            onLayout={this.handleLayout.bind(this)}
            style={{
              width: this.props.imageWidth,
              height: this.props.imageHeight,
            }}
          >
            {this.props.children}
          </View>
        </Animated.View>
      </View>
    );
  }
}
