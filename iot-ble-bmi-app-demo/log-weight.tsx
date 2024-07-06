/**
 * THIS FILE HAS BEEN CONSOLIDATED WITH CODE FROM MULTIPLE FILES FOR THE SAKE OF SAVING THE REVIEWERS TIME.
 *
*/
import { yupResolver } from '@hookform/resolvers/yup';
import format from 'date-fns/format';
import LottieView from 'lottie-react-native';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { TouchableOpacity, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { Notifier, NotifierComponents, Easing } from 'react-native-notifier';
import * as yup from 'yup';

import { FinalWeighinMeasurement, WeighinForm } from '@app-types/measurement';
import LottieFindingWeighScale from '@assets/lottie/finding-weigh-scale.json';
import LottieMeasuring from '@assets/lottie/measure_weighin.json';
import LottieWeighCheck from '@assets/lottie/weight-check.json';
import { ManualWeighin } from '@components/app-specific';
import { InstructionModal } from '@components/app-specific/instruction-modal';
import {
  BackButton,
  BottomModal,
  Button,
  LoadingButton,
  VectorIcon,
} from '@components/core';
import { Typography } from '@components/core/typography';
import { Container } from '@components/layout';
import { IScaleStateEnum, useAuth, useYolandaDeviceListener } from '@hooks';
import { useTheme } from '@theme';
import { getErrorMessage } from '@utils';

import { useLogWeightContainerStyle } from './log-weight.styles';
import { LogWeightContainerProps } from './log-weight.type';

const manualWeighInSchema = yup.object().shape({
  current_weight: yup
    .string()
    .required('Weight is required')
    .matches(
      /^\d+(\.\d{1,2})?$/,
      'Weight must be a number with up to 2 decimal places',
    )
    .test(
      'is-valid-weight',
      'Weight must be between 50 and 1000 lbs',
      value => {
        if (value === undefined) return false;
        const weight = parseFloat(value);

        return !isNaN(weight) && weight >= 50 && weight <= 1000;
      },
    ),
  body_fat: yup
    .string()
    .matches(
      /^$|^\d+(\.\d{1,2})?$/,
      'Body fat must be a number with up to 2 decimal places',
    )
    .test('is-valid-body-fat', 'Body fat must be between 2% and 90%', value => {
      if (value === undefined || value === '') return true;
      const bodyFat = parseFloat(value);

      return !isNaN(bodyFat) && bodyFat >= 2 && bodyFat <= 90;
    }),
  fat_mass: yup
    .string()
    .matches(
      /^$|^\d+(\.\d{1,2})?$/,
      'Fat mass must be a number with up to 2 decimal places',
    )
    .test(
      'is-valid-fat-mass',
      'Fat mass must be between 5 and 1000 lbs',
      value => {
        if (value === undefined || value === '') return true;
        const fatMass = parseFloat(value);

        return !isNaN(fatMass) && fatMass >= 5 && fatMass <= 1000;
      },
    ),
  muscle_mass: yup
    .string()
    .matches(
      /^$|^\d+(\.\d{1,2})?$/,
      'Muscle mass must be a number with up to 2 decimal places',
    )
    .test(
      'is-valid-muscle-mass',
      'Muscle mass must be between 25 and 1000 lbs',
      value => {
        if (value === undefined || value === '') return true;
        const muscleMass = parseFloat(value);

        return !isNaN(muscleMass) && muscleMass >= 25 && muscleMass <= 1000;
      },
    ),
  visceral_fat: yup
    .string()
    .matches(
      /^$|^\d+(\.\d{1,2})?$/,
      'Visceral fat must be a number with up to 2 decimal places',
    )
    .test(
      'is-valid-visceral-fat',
      'Visceral fat must be between 1 and 100',
      value => {
        if (value === undefined || value === '') return true;
        const visceralFat = parseFloat(value);

        return !isNaN(visceralFat) && visceralFat >= 1 && visceralFat <= 100;
      },
    ),
});

const scaleSchema = manualWeighInSchema.omit(['fat_mass']);

const getDefaultWeighinFormValues = (
  measurement: FinalWeighinMeasurement | null,
) => {
  if (!measurement) {
    return {
      current_weight: '',
      body_fat: '',
      fat_mass: '',
      muscle_mass: '',
      visceral_fat: '',
    };
  }

  return {
    current_weight: String(measurement.current_weight),
    body_fat: String(measurement.body_fat || ''),
    muscle_mass: String(measurement.muscle_mass || ''),
    visceral_fat: String(measurement.visceral_fat_tanita || ''),
  };
};

function shouldShowWarning(measurements: FinalWeighinMeasurement) {
  const { current_weight, ...otherMeasurements } = measurements;

  // Check if current_weight has a valid value
  if (current_weight === undefined || current_weight === 0) {
    return false;
  }

  // Check if all other measurements are empty, undefined, or 0
  const areOtherMeasurementsEmpty = Object.values(otherMeasurements).some(
    value => value === undefined || value === 0,
  );

  return areOtherMeasurementsEmpty;
}

const LogWeightContainer: React.FC<LogWeightContainerProps> = props => {
  const { handlers, data } = props;
  const { selectedDate, mutationResult } = data;
  const { onBack } = handlers;
  const styles = useLogWeightContainerStyle();
  const { t } = useTheme();
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [recordManually, setRecordManually] = useState(false);
  const {
    status,
    resetScale,
    onStartScaleScan,
    onStopScaleScan,
    startScaleScan,
    measurement,
    device,
  } = useYolandaDeviceListener();
  const finalSchema = measurement ? scaleSchema : manualWeighInSchema;
  const { control, handleSubmit, reset } = useForm<WeighinForm>({
    mode: 'onTouched',
    resolver: yupResolver(finalSchema),
    defaultValues: getDefaultWeighinFormValues(measurement),
  });
  const { user } = useAuth();

  const onStartScale = () => {
    setRecordManually(false);

    void onStartScaleScan();
  };

  const onRecordManually = () => {
    if (startScaleScan) {
      onStopScaleScan();
    }

    setRecordManually(true);
    reset(getDefaultWeighinFormValues(null));
  };

  const onRestartScaleScan = () => {
    void resetScale();
    void onStartScaleScan();
  };

  const handleWeighinSubmit = (weighIns: WeighinForm) => {
    // Filter out empty and zero values
    // Zero values could create issues with the metric conversion
    const filteredWeighIns = Object.entries(weighIns).reduce<
      Partial<WeighinForm>
    >((acc, [key, value]) => {
      const newAcc = { ...acc };

      if (value && value !== '0') {
        newAcc[key as keyof WeighinForm] = value ? Number(value) : value;
      }

      return newAcc;
    }, {});

    if (measurement) {
      filteredWeighIns.coachcare_external_device_id = 17;
      // fat_mass is not required when weighing in with the scale
      delete filteredWeighIns.fat_mass;

      if (measurement.basal_metabolic_rate) {
        filteredWeighIns.basal_metabolic_rate =
          measurement.basal_metabolic_rate;
      }

      if (measurement.fat_free_mass) {
        filteredWeighIns.fat_free_mass = measurement.fat_free_mass;
      }

      if (measurement.water_percentage) {
        filteredWeighIns.body_water_percent = measurement.water_percentage;
      }

      filteredWeighIns.device_details = device ?? undefined;
    } else {
      filteredWeighIns.coachcare_external_device_id = 3;
    }

    mutationResult.mutate(filteredWeighIns, {
      onSuccess: () => {
        Notifier.showNotification({
          title: 'Yippie!',
          description:
            'Congratulations on completing your weigh-in! Your dedication to your health and wellness journey is truly inspiring 🙌🏽 !',
          Component: NotifierComponents.Alert,
          componentProps: {
            alertType: 'success',
          },
          duration: 8000,
          showAnimationDuration: 800,
          showEasing: Easing.bounce,
          hideOnPress: true,
        });

        onBack();
      },
      onError: err => {
        Notifier.showNotification({
          title: 'Oops!',
          description: getErrorMessage(err),
          Component: NotifierComponents.Alert,
          componentProps: {
            alertType: 'error',
          },
          duration: 8000,
          showAnimationDuration: 800,
          showEasing: Easing.bounce,
          hideOnPress: true,
        });
      },
    });
  };

  const onSubmitManualWeighIns = handleSubmit(handleWeighinSubmit);

  const renderInstructions = () => {
    return (
      <View style={styles.instructionList}>
        {/* Message */}
        <View style={styles.instructionItem}>
          <VectorIcon
            family="Feather"
            name="check"
            size={24}
            color={t.palette.text.success}
          />

          <Typography variant="body2" style={styles.instructionLabel}>
            ALWAYS use the scale on a flat and hard floor surface
          </Typography>
        </View>

        {/* Message */}
        <View style={styles.instructionItem}>
          <VectorIcon name="close" size={24} color={t.palette.text.error} />

          <Typography variant="body2" style={styles.instructionLabel}>
            Do NOT wear shoes or socks when weighing yourself
          </Typography>
        </View>

        <View style={styles.instructionItem}>
          <VectorIcon
            family="Feather"
            name="check"
            size={24}
            color={t.palette.text.success}
          />

          <Typography variant="body2" style={styles.instructionLabel}>
            ALLOW the app to access your bluetooth
          </Typography>
        </View>

        <View style={styles.instructionItem}>
          <VectorIcon
            family="Feather"
            name="check"
            size={24}
            color={t.palette.text.success}
          />

          <Typography variant="body2" style={styles.instructionLabel}>
            QUIT the app completely and retry in case the scale is not
            connecting
          </Typography>
        </View>

        {/* Message */}
        <View style={styles.instructionItem}>
          <VectorIcon name="close" size={24} color={t.palette.text.error} />

          <Typography variant="body2" style={styles.instructionLabel}>
            Do NOT step down from the scale until you see the final measurement
          </Typography>
        </View>
      </View>
    );
  };

  useEffect(() => {
    if (measurement) {
      // reset the manual weigh in form and reset the default values
      reset(getDefaultWeighinFormValues(measurement));
    }
  }, [measurement, reset]);

  /**
   * Renders the warning message when we could only capture the current weight
   * and not the other measurements like body fat, muscle mass, etc. from the
   * scale.
   *
   */
  const renderWarning = () => {
    return (
      <View style={styles.warning}>
        <Typography color="error" weight="bold">
          It seems we only captured your weight
        </Typography>

        <Typography color="error">
          1) Please make sure you are{' '}
          <Typography color="error" weight="bold">
            not
          </Typography>{' '}
          wearing shoes or socks
        </Typography>

        <Typography color="error">
          2) Please wait before stepping off the scale until the{' '}
          <Typography color="error" weight="bold">
            final measurements
          </Typography>{' '}
          appear on the screen
        </Typography>
      </View>
    );
  };

  const renderContent = () => {
    if (startScaleScan && !status) {
      return (
        <>
          <LottieView
            autoPlay
            style={styles.lottieView}
            source={LottieFindingWeighScale}
          />

          <Typography
            align="center"
            variant="h2"
            color="secondary"
            style={styles.title}
          >
            Please step onto the scale...
          </Typography>

          {renderInstructions()}
        </>
      );
    }

    if (startScaleScan && status) {
      return (
        <>
          <LottieView
            autoPlay
            style={styles.lottieView}
            source={LottieMeasuring}
          />

          <Typography
            variant="h2"
            weight="bold"
            textTransform="capitalize"
            style={styles.title}
            align="center"
            color="secondary"
          >
            {status === IScaleStateEnum.MEASURING
              ? 'Gathering the measurement...'
              : `${status} to your scale...`}
          </Typography>

          <Typography
            variant="h3"
            align="center"
            color="error"
            style={styles.title}
          >
            Do not step off!
          </Typography>

          {renderInstructions()}
        </>
      );
    }

    if (!startScaleScan && measurement) {
      // Create a showWarning flag to show the warning message. This flag will be true if we only captured the current weight and not the other measurements like body fat, muscle mass, etc. from the scale. Loop through the measurement object and check if only the current_weight is present and the rest is zero/undefined/empty. If it is, set the showWarning flag to true.
      const showWarning = shouldShowWarning(measurement);

      return (
        <>
          {showWarning ? renderWarning() : null}

          <ManualWeighin
            linkLabel="Record manually instead?"
            onLinkPress={onRecordManually}
            control={control}
            type="auto"
            onSubmit={onSubmitManualWeighIns}
          />
        </>
      );
    }

    if (recordManually) {
      return (
        <ManualWeighin
          linkLabel="Scan for scale instead?"
          control={control}
          onLinkPress={onStartScale}
          type="manual"
          onSubmit={onSubmitManualWeighIns}
        />
      );
    }

    return (
      <>
        <LottieView
          autoPlay
          style={styles.lottieView}
          source={LottieWeighCheck}
        />

        {renderInstructions()}
      </>
    );
  };

  const renderCTA = () => {
    if (recordManually) {
      return (
        <LoadingButton
          loading={mutationResult.isPending}
          size="large"
          onPress={onSubmitManualWeighIns}
          style={styles.recordCTA}
        >
          Save
        </LoadingButton>
      );
    }

    if (!startScaleScan && measurement) {
      return (
        <View style={styles.footerCTAContainer}>
          <LoadingButton
            size="large"
            containerStyle={styles.footerCTA}
            onPress={onSubmitManualWeighIns}
            loading={startScaleScan || mutationResult.isPending}
          >
            Save
          </LoadingButton>

          <Button
            size="large"
            variant="outlined"
            onPress={onRestartScaleScan}
            containerStyle={styles.footerCTA}
            disabled={startScaleScan || mutationResult.isPending}
          >
            Restart?
          </Button>
        </View>
      );
    }

    return (
      <View style={styles.footerCTAContainer}>
        <Button
          size="large"
          containerStyle={styles.footerCTA}
          onPress={onStartScale}
          disabled={startScaleScan}
        >
          Start Scale Scan
        </Button>

        <Button
          size="large"
          variant="outlined"
          onPress={onRecordManually}
          containerStyle={styles.footerCTA}
        >
          Record Manually
        </Button>
      </View>
    );
  };

  return (
    <Container style={styles.container} testID="TestID__container-LogWeight">
      <View>
        <View style={styles.topHeader}>
          <BackButton color="secondary" label="Back" onPress={onBack} />

          <TouchableOpacity onPress={() => setShowHelpModal(true)}>
            <VectorIcon family="AntDesign" name="questioncircle" size={20} />
          </TouchableOpacity>
        </View>

        <View style={styles.header}>
          <View>
            {/* E.g Sun, 5 Feb, 2023 */}
            <Typography variant="h4">
              {format(new Date(selectedDate), 'EEE, d MMM, yyyy')}
            </Typography>

            <Typography color="secondary" variant="h2" style={styles.title}>
              Weekly Weigh-in
            </Typography>
          </View>
        </View>
      </View>

      {/* Animations and form */}
      <KeyboardAwareScrollView
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="never"
      >
        {renderContent()}
      </KeyboardAwareScrollView>

      {/* Call to actions */}
      <View style={styles.footer}>{renderCTA()}</View>

      <BottomModal
        isVisible={showHelpModal}
        onClose={() => setShowHelpModal(false)}
        testID={'TestID__component-Help-Modal'}
        title="Scale Instructions"
      >
        {user ? (
          <InstructionModal
            youtubeVideoIds={['765w1oxrxVM', '2xw_C-3ebbs']}
            supportLink="https://support.awaken180weightloss.com/hc/en-us/articles/25753885609357-How-to-weigh-in-using-the-new-Awaken180-App"
            problemStatement="scale"
            user={user}
            screenName="Log Weight Instructions"
          />
        ) : null}
      </BottomModal>
    </Container>
  );
};

export default LogWeightContainer;
