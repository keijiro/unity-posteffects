
#pragma strict

@CustomEditor (CameraMotionBlur)
class CameraMotionBlurEditor extends Editor 
{	
	var serObj : SerializedObject;	
		
  var filterType : SerializedProperty;
  var preview : SerializedProperty;
  var previewScale : SerializedProperty;
  var movementScale : SerializedProperty;
  var rotationScale : SerializedProperty;
  var maxVelocity : SerializedProperty;
  var minVelocity : SerializedProperty;
  var velocityScale : SerializedProperty;
  var velocityDownsample : SerializedProperty;
  var noiseTexture : SerializedProperty;
  var showVelocity : SerializedProperty;
  var showVelocityScale : SerializedProperty;
  var excludeLayers : SerializedProperty;
  //var dynamicLayers : SerializedProperty;

	function OnEnable () {
		serObj = new SerializedObject (target);
		
    filterType = serObj.FindProperty ("filterType");

    preview = serObj.FindProperty ("preview");
    previewScale = serObj.FindProperty ("previewScale");

    movementScale = serObj.FindProperty ("movementScale");
    rotationScale = serObj.FindProperty ("rotationScale");

    maxVelocity = serObj.FindProperty ("maxVelocity");
    minVelocity = serObj.FindProperty ("minVelocity");

    excludeLayers = serObj.FindProperty ("excludeLayers");
    //dynamicLayers = serObj.FindProperty ("dynamicLayers");

    velocityScale = serObj.FindProperty ("velocityScale");
    velocityDownsample = serObj.FindProperty ("velocityDownsample");

    noiseTexture = serObj.FindProperty ("noiseTexture");
	} 
    		
  function OnInspectorGUI () {         
    serObj.Update ();
        	    	
    EditorGUILayout.LabelField("Simulates camera based motion blur", EditorStyles.miniLabel);

    EditorGUILayout.PropertyField (filterType, new GUIContent("Technique"));  	
    EditorGUILayout.PropertyField (velocityScale, new GUIContent(" Velocity Scale"));   
    EditorGUILayout.PropertyField (maxVelocity, new GUIContent(" Velocity Max"));   
    EditorGUILayout.PropertyField (minVelocity, new GUIContent(" Velocity Min"));   

    EditorGUILayout.Separator ();

    EditorGUILayout.LabelField("Technique Specific");

    if(filterType.enumValueIndex == 0) {
      // portal style motion blur
      EditorGUILayout.PropertyField (rotationScale, new GUIContent(" Camera Rotation"));
      EditorGUILayout.PropertyField (movementScale, new GUIContent(" Camera Movement"));
    }
    else {
      // "plausible" blur or cheap, local blur
      EditorGUILayout.PropertyField (excludeLayers, new GUIContent(" Exclude Layers"));
      EditorGUILayout.PropertyField (velocityDownsample, new GUIContent(" Velocity Downsample"));
      velocityDownsample.intValue = velocityDownsample.intValue < 1 ? 1 : velocityDownsample.intValue;
      if(filterType.enumValueIndex == 2) // only display jitter for reconstruction
        EditorGUILayout.PropertyField (noiseTexture, new GUIContent(" Sample Jitter"));
    }

    EditorGUILayout.Separator ();

    EditorGUILayout.PropertyField (preview, new GUIContent("Preview"));
    if (preview.boolValue)
      EditorGUILayout.PropertyField (previewScale, new GUIContent(" Preview Scale"));    
        	
    serObj.ApplyModifiedProperties();
    }
}
