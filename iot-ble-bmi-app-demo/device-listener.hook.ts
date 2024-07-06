import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { NativeEventEmitter } from 'react-native';
import {
  BleQnsdk,
  FinalMeasurementResponse,
  YolandaDeviceInfo,
  YolandaEventEmitter,
  YolandaEventTypeEnum,
  buildYolandaUser,
  startYolandaScan,
} from 'react-native-ble-qnsdk';
import { Notifier, NotifierComponents, Easing } from 'react-native-notifier';

import { FinalWeighinMeasurement } from '@app-types/measurement';
import { DashboardStackParamList, RouteNames } from '@app-types/navigation';
import { useAuth } from '@hooks/auth';
import {
  EXCEPTION_TAG_TYPES,
  captureException,
  getErrorMessage,
  gramsToPounds,
  initBluetooth,
  unitToPercentage,
} from '@utils';

import {
  IScaleStateEnum,
  IYolandaConnectionState,
} from './yolanda-device-listener.type';

const calculateMeaurement = (
  value: FinalMeasurementResponse,
): FinalWeighinMeasurement => {
  const {
    basalMetabolicRate,
    bodyFat,
    fatFreeMass,
    muscleMass,
    visceralFatTanita,
    skeletalMuscleRatio,
    waterPercentage,
    weight,
  } = value;

  const currentWeight = gramsToPounds(weight);
  const bodyFatInPercentage = unitToPercentage(bodyFat);

  return {
    current_weight: currentWeight,
    body_fat: bodyFatInPercentage,
    muscle_mass: gramsToPounds(muscleMass),
    visceral_fat_tanita: visceralFatTanita,
    basal_metabolic_rate: basalMetabolicRate,
    fat_free_mass: gramsToPounds(fatFreeMass),
    fat_mass: Number(((bodyFatInPercentage / 100) * currentWeight).toFixed(1)),
    skeletal_muscle_ratio: skeletalMuscleRatio,
    water_percentage: unitToPercentage(waterPercentage),
  };
};

const QNSDKEmitter = new NativeEventEmitter(BleQnsdk);

const useYolandaDeviceListener = () => {
  const { user } = useAuth();
  const { navigate } =
    useNavigation<NativeStackNavigationProp<DashboardStackParamList>>();
  const [device, setDevice] = useState<YolandaDeviceInfo | null>(null);
  const [status, setStatus] = useState<IScaleStateEnum | null>(null);
  const [measurement, setMeasurement] =
    useState<FinalWeighinMeasurement | null>(null);
  const [startScaleScan, setStartScaleScan] = useState(false);

  const onStopScaleScan = useCallback(() => {
    setStartScaleScan(false);
  }, []);

  const onUserInfoError = useCallback(
    (message: string) => {
      Notifier.showNotification({
        title: 'Oops!',
        description: getErrorMessage(message),
        Component: NotifierComponents.Alert,
        componentProps: {
          alertType: 'error',
        },
        duration: 6000,
        showAnimationDuration: 800,
        showEasing: Easing.bounce,
        hideOnPress: true,
      });

      return navigate(RouteNames.UserProfileForm);
    },
    [navigate],
  );

  // Init bluetooth and add listeners
  const handleBluetoothInit = useCallback(async () => {
    try {
      await initBluetooth();
    } catch (error) {
      throw new Error(
        (error as Error)?.message ||
          "We couldn't connect to your bluetooth. Make sure you have provided the necessary permissions.",
      );
    }
  }, []);

  const onStartScaleScan = useCallback(async () => {
    if (!user?.height || !user?.gender || !user?.birthday) {
      return onUserInfoError(
        'Please complete your profile as we require your birth date, gender and height to calculate your BMI.',
      );
    }

    // if birthday is not parseable or the format is incorrect, show user an error
    if (Number.isNaN(Date.parse(user.birthday))) {
      return onUserInfoError(
        'Please provide a valid birth date to calculate your BMI.',
      );
    }

    setStartScaleScan(true);

    // height in cms
    const [feet, inches] = user.height.split('_').map(Number);
    const heightUnit = Math.round((feet * 12 + inches) * 2.54);

    const userInfo = {
      birthday: user.birthday,
      gender: user.gender.toLowerCase(), // "male" or "female"
      id: user.email,
      height: heightUnit, // Height in cm
      unit: 1, // Measurement unit (1 for metric, 2 for imperial)
      athleteType: Number(!!user.athlete_mode), // Athlete type (0 for general, 1 for athlete)
    };

    try {
      await handleBluetoothInit();
      await buildYolandaUser(userInfo);
      await startYolandaScan();
    } catch (error) {
      let message = getErrorMessage(
        error,
        'Unfortunatly, we could not connect. Please try again.',
      );

      if (message.includes('1002') || message.includes('1005')) {
        message =
          'This app is not authorized to connect to the scale. Please contact support.';
      }

      Notifier.showNotification({
        title: 'Oops!',
        description: message,
        Component: NotifierComponents.Alert,
        componentProps: {
          alertType: 'error',
        },
        duration: 15000,
        showAnimationDuration: 800,
        showEasing: Easing.bounce,
        hideOnPress: true,
      });

      onStopScaleScan();
    }
  }, [onStopScaleScan, user, onUserInfoError, handleBluetoothInit]);

  const filterStateChange = useCallback(
    (value: number): void => {
      switch (value) {
        case IYolandaConnectionState.QNScaleStateMeasureCompleted:
          return setStatus(IScaleStateEnum.COMPLETE);
        case IYolandaConnectionState.QNScaleStateDisconnected:
        case IYolandaConnectionState.QNScaleStateLinkLoss:
          return setStatus(IScaleStateEnum.DISCONNECTED);
        case IYolandaConnectionState.QNScaleStateConnecting:
          return setStatus(IScaleStateEnum.CONNECTING);
        case IYolandaConnectionState.QNScaleStateConnected:
        case IYolandaConnectionState.QNScaleStateRealTime:
          return setStatus(IScaleStateEnum.CONNECTED);
        case IYolandaConnectionState.QNScaleStateStartMeasure:
        case IYolandaConnectionState.QNScaleStateBodyFat:
          return setStatus(IScaleStateEnum.MEASURING);
      }
    },
    [setStatus],
  );

  const finalMeasurementResponse = useCallback(
    (value: FinalMeasurementResponse): void => {
      setMeasurement(calculateMeaurement(value));
      onStopScaleScan();
    },
    [onStopScaleScan],
  );

  const notificationFilter = useCallback(
    async (response: YolandaEventEmitter) => {
      try {
        if (response.type === YolandaEventTypeEnum.SCALE_STATE_CHANGE) {
          filterStateChange(response.value);
        }
        if (response.type === YolandaEventTypeEnum.FINAL_MEASUREMENT_EVENT) {
          finalMeasurementResponse(response.value);
        }
        if (response.type === YolandaEventTypeEnum.DEVICE_INFO) {
          setDevice(response.value);
        }
      } catch (error) {
        captureException(getErrorMessage(error), {
          extra: {
            hook: 'useYolandaDeviceListener',
            method: 'notificationFilter',
          },
          tags: {
            type: EXCEPTION_TAG_TYPES.DEVICE,
          },
        });
      }
    },
    [filterStateChange, finalMeasurementResponse],
  );

  const resetScale = useCallback(() => {
    setDevice(null);
    setStatus(null);
    setMeasurement(null);
  }, []);

  // Add listeners
  useEffect(() => {
    const progressSubscription = QNSDKEmitter.addListener(
      'uploadProgress',
      (response: YolandaEventEmitter) => {
        void notificationFilter(response);
      },
    );

    return () => {
      progressSubscription?.remove();
    };
  }, [notificationFilter]);

  return {
    device,
    status,
    resetScale,
    measurement,
    startScaleScan,
    onStartScaleScan,
    onStopScaleScan,
    handleBluetoothInit,
  };
};

export default useYolandaDeviceListener;
